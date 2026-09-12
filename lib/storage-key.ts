/**
 * Filenames as an associate types them, made safe to use as a storage key.
 *
 * Supabase Storage rejects a key containing characters an em dash, a curly
 * quote or an accent puts there, and real contract filenames are full of them
 * ("Hilton Denver — NACE '27 (rev 2).docx"). The upload then failed with a raw
 * "Invalid key" from the storage layer.
 *
 * Only the key is rewritten. The name shown to the associate is stored
 * separately on the analysis row, exactly as they had it.
 */

const MAX_STEM = 120;

export function storageSafeName(filename: string, fallback = "contract"): string {
  const dot = filename.lastIndexOf(".");
  const hasExtension = dot > 0 && dot < filename.length - 1;

  const clean = (part: string) =>
    part
      // Decompose accents, then drop the combining marks: "Café" -> "Cafe".
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      // Supabase accepts these; it is the non-ASCII that breaks a key.
      .replace(/[^A-Za-z0-9 ._\-(),&'+@!]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/\s{2,}/g, " ")
      .replace(/^[-. ]+|[-. ]+$/g, "");

  const stem = clean(hasExtension ? filename.slice(0, dot) : filename).slice(0, MAX_STEM);
  const extension = hasExtension ? clean(filename.slice(dot + 1)) : "";

  if (!stem) return extension ? `${fallback}.${extension}` : fallback;
  return extension ? `${stem}.${extension}` : stem;
}
