import { createAdminClient } from "./supabase/admin";

/**
 * The compliance record and feedback loop (build brief §2 non-negotiable #4,
 * §6). Called from every route that does something worth a record — never
 * bolted on after the fact. actorId is nullable for system-initiated events
 * (e.g. a background job) that aren't attributable to a specific click.
 */
export async function logAudit(entry: {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("audit_log").insert({
    actor_id: entry.actorId ?? null,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    metadata_json: entry.metadata ?? null,
  });

  if (error) {
    // Audit logging failing should never take down the request it's
    // describing, but it must not fail silently either.
    console.error("audit log write failed:", error.message, entry);
  }
}
