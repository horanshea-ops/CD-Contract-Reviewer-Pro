/**
 * Whether a finding's proposed language is a replacement clause or just a note
 * saying nothing needs to change.
 *
 * The model returns the latter occasionally — "No change needed — retain as
 * drafted." — and an associate can accept that finding. Every export then reads
 * it as replacement wording. §1.7.7 caught it live against the real CD standard
 * contract, where it replaced a rate-parity clause with that sentence in a
 * document bound for the property.
 *
 * Severity cannot identify these. Two of 335 findings in the dev database look
 * like commentary and they are "low" and "note", while other "note" findings
 * carry real clause text. So the assertion itself is matched.
 *
 * Kept narrow and anchored to the start, so it catches the statement and not
 * clause text that happens to open with "No" or mention a change. It fails
 * safe either way: a false positive drops a change that was never a change,
 * and a false negative leaves today's behaviour.
 */
const ASSERTS_NO_CHANGE =
  /^\s*(no\s+(change|revision|edit|amendment)s?\b|none\s+needed\b|not\s+applicable\b|n\/a\b|retain\s+as\s+(drafted|written)\b|acceptable\s+as\s+(drafted|written)\b)/i;

export function assertsNoChange(language: string | null | undefined): boolean {
  return !!language && ASSERTS_NO_CHANGE.test(language);
}
