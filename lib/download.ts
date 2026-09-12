/**
 * Downloads a file from an export route and resolves once it has arrived.
 *
 * The caller needs to know the download actually happened. Pointing an anchor
 * at the URL starts a navigation nobody can observe, so several at once lose
 * all but one to the browser's popup blocking while every one of them still
 * looks like it worked. Fetching gives a real completion signal and a real
 * failure.
 *
 * Export routes have side effects — each writes a row to `exports` that
 * §1.6.5's weekly review and §1.6.6's degradation rate are read from. A
 * next/link pointing at one gets prefetched and fires the route without anyone
 * clicking. An export is an action, so it stays triggered as one.
 */
export async function downloadFile(url: string, fallbackFilename: string): Promise<void> {
  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "The download failed.");
  }

  const blob = await res.blob();
  const filename = filenameFromResponse(res) ?? fallbackFilename;
  save(blob, filename);
}

function save(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

/**
 * Reads the server's chosen filename off Content-Disposition.
 *
 * Returns null rather than guessing when the header is missing or unreadable —
 * a real contract filename can carry punctuation that does not survive an HTTP
 * header, and the caller's fallback is better than a mangled name.
 */
function filenameFromResponse(res: Response): string | null {
  const header = res.headers.get("Content-Disposition");
  if (!header) return null;

  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim()) || null;
    } catch {
      return null;
    }
  }

  const quoted = /filename="([^"]*)"/i.exec(header) ?? /filename=([^;]+)/i.exec(header);
  return quoted ? quoted[1].trim() || null : null;
}
