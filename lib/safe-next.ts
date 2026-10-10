/** A stand-in for the app's own address. `.invalid` can never be a real site. */
const APP = "http://app.invalid";

/** The path a browser makes of `value`, or null when it leads off the app. */
function inAppPath(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value, APP);
  } catch {
    return null;
  }
  if (url.origin !== APP) return null;
  return url.pathname + url.search + url.hash;
}

/**
 * Where to go after sign-in, taken from a `next` parameter.
 *
 * Only an in-app path is followed. The value is resolved the way a browser
 * resolves a link, which drops tabs and newlines and reads "\" as "/", and it
 * is followed only when the result stays on the app. Anything else falls back
 * to the dashboard.
 *
 * The cleaned path is resolved a second time, because "/.//host" cleans to
 * "//host", which a browser reads as another site.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) return "/";

  const path = inAppPath(value);
  if (path === null || inAppPath(path) !== path) return "/";

  return path;
}
