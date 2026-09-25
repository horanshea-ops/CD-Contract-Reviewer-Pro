import type { DocxPackage } from "./parts";
import type { ContractPicture, PictureImage } from "./types";

/**
 * Pictures in the contract body big enough to hold a table or figures.
 *
 * Extraction reads text only, so a room block pasted in as a picture never
 * reaches the arithmetic checks. A real contract carried its rates that way.
 * A readable picture is sent to the model with the text. Any other is noted
 * so the review says it wasn't read.
 *
 * A drawing counts when it is shown large and its image has the pixels to
 * hold text. Icons and bullets fall under the first test, and a tiny icon
 * stretched across the page falls under the second. Logos usually sit in
 * headers, which aren't read here.
 */

const EMU_PER_INCH = 914_400;
const MIN_WIDTH = 3 * EMU_PER_INCH;
const MIN_HEIGHT = 0.3 * EMU_PER_INCH;

const MIN_WIDTH_PX = 200;
const MIN_HEIGHT_PX = 30;

/** The model's limits on one image. */
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_SIDE_PX = 8_000;

/** Each picture adds input tokens, so a contract sends at most this many. */
export const MAX_PICTURES = 4;

/** How far back, in XML characters, to look for the paragraph before a picture. */
const LOOKBACK = 8_000;
const NEAR_WORDS = 12;

const IMAGE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

const unescape = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const textOf = (xml: string) =>
  [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
    .map((m) => unescape(m[1]))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

interface Image {
  mediaType: PictureImage["mediaType"];
  width: number;
  height: number;
}

/** The format and pixel size from an image's header, or null for formats the model can't read. */
export function imageInfo(b: Uint8Array): Image | null {
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u32be = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u24le = (i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === "PNG") {
    return { mediaType: "image/png", width: u32be(16), height: u32be(20) };
  }
  if (b.length >= 10 && ascii(0, 4) === "GIF8") {
    return { mediaType: "image/gif", width: u16le(6), height: u16le(8) };
  }
  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8X") return { mediaType: "image/webp", width: u24le(24) + 1, height: u24le(27) + 1 };
    if (chunk === "VP8 ") return { mediaType: "image/webp", width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { mediaType: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    // Walk the segments to the frame header, which holds the size.
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { mediaType: "image/jpeg", width: u16be(i + 7), height: u16be(i + 5) };
      i += 2 + u16be(i + 2);
    }
  }
  return null;
}

/** Image relationship ids in the document body, mapped to archive paths. */
async function imageTargets(pkg: DocxPackage): Promise<Map<string, string>> {
  const targets = new Map<string, string>();
  const rels = await pkg.zip.file("word/_rels/document.xml.rels")?.async("string");
  if (!rels) return targets;
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const attr = (name: string) => m[0].match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
    const [id, type, target] = [attr("Id"), attr("Type"), attr("Target")];
    if (!id || type !== IMAGE_REL || !target || attr("TargetMode") === "External") continue;
    targets.set(id, target.startsWith("/") ? target.slice(1) : `word/${target}`);
  }
  return targets;
}

export async function findPictures(pkg: DocxPackage): Promise<{ pictures: ContractPicture[]; images: PictureImage[] }> {
  const xml = pkg.document.xml;
  const targets = await imageTargets(pkg);
  const pictures: ContractPicture[] = [];
  const images: PictureImage[] = [];

  for (const drawing of xml.matchAll(/<w:drawing>[\s\S]*?<\/w:drawing>/g)) {
    const extent = drawing[0].match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
    if (!extent || !drawing[0].includes("<a:blip")) continue;
    if (Number(extent[1]) < MIN_WIDTH || Number(extent[2]) < MIN_HEIGHT) continue;

    const embed = drawing[0].match(/<a:blip\b[^>]*\br:embed="([^"]+)"/)?.[1];
    const path = embed ? targets.get(embed) : undefined;
    const bytes = path ? await pkg.zip.file(path)?.async("uint8array") : undefined;
    const image = bytes ? imageInfo(bytes) : null;
    if (image && (image.width < MIN_WIDTH_PX || image.height < MIN_HEIGHT_PX)) continue;

    // The nearest paragraph with text before the picture, which is usually its heading.
    const before = xml.slice(Math.max(0, drawing.index! - LOOKBACK), drawing.index);
    const paragraph = before
      .split("</w:p>")
      .map(textOf)
      .reverse()
      .find((t) => t.length > 0);
    const words = (paragraph ?? "").split(" ");
    const near = words.length > NEAR_WORDS ? `${words.slice(0, NEAR_WORDS).join(" ")}…` : words.join(" ");

    const readable =
      !!bytes &&
      !!image &&
      bytes.byteLength <= MAX_BYTES &&
      Math.max(image.width, image.height) <= MAX_SIDE_PX &&
      images.length < MAX_PICTURES;
    pictures.push({ near, readable });
    if (readable) images.push({ near, mediaType: image!.mediaType, data: Buffer.from(bytes!).toString("base64") });
  }
  return { pictures, images };
}
