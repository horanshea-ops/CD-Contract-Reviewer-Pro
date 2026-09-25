/**
 * Where to go after sign-in, taken from a `next` parameter.
 *
 * Only an in-app path is followed. "//host" and "/\host" are treated by
 * browsers as links to another site, so they fall back to the dashboard like
 * any full URL does.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}
