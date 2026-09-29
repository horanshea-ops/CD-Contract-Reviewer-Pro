/**
 * Rules for managing associates. The associates table is also the sign-in
 * allowlist: an active row lets that email in, a revoked row keeps it out.
 */

export interface AssociateRow {
  id: string;
  name: string;
  email: string;
  is_admin: boolean;
  status: "active" | "revoked";
  created_at: string;
}

export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

/**
 * Why a change can't be made, or null when it can. An admin can't lock
 * themselves out, and the app always keeps one active admin.
 */
export function changeBlocked(
  actorId: string,
  target: AssociateRow,
  change: { is_admin?: boolean; status?: AssociateRow["status"] },
  everyone: AssociateRow[]
): string | null {
  const self = target.id === actorId;
  if (self && change.status === "revoked") return "You can't revoke your own access.";
  if (self && change.is_admin === false) return "You can't remove your own admin access.";

  const losesAdmin =
    target.is_admin && target.status === "active" && (change.is_admin === false || change.status === "revoked");
  const otherAdmins = everyone.filter((a) => a.id !== target.id && a.is_admin && a.status === "active");
  if (losesAdmin && otherAdmins.length === 0) return "The app needs at least one active admin.";

  return null;
}
