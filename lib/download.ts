/**
 * Starts a file download from a URL.
 *
 * Export routes have side effects — each one writes a row to `exports` that
 * §1.6.5's weekly review and §1.6.6's degradation rate are read from. A
 * next/link pointing at one gets prefetched and fires the route without anyone
 * clicking, which runs the engine twice and logs the export twice. An export is
 * an action, so it is triggered as one.
 */
export function startDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
