/**
 * The password rules, shared by the account form and the route that saves it.
 * Supabase's own minimum should be set to the same length.
 */
export const MIN_PASSWORD_LENGTH = 8;

/** Why a new password can't be saved, or null when it can. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}
