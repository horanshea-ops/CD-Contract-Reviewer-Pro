import { redirect } from "next/navigation";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import StandardsList, { type StandardRow } from "./standards-list";

export default async function StandardsAdminPage() {
  const associate = await getCurrentAssociate();
  if (!associate) redirect("/login");
  if (!associate.is_admin) redirect("/");

  const admin = createAdminClient();
  const { data: standards } = await admin
    .from("standards")
    .select("*")
    .order("clause_type", { ascending: true });

  const rows = (standards ?? []) as StandardRow[];

  const associateIds = Array.from(
    new Set(rows.flatMap((r) => [r.validated_by, r.updated_by]).filter((v): v is string => !!v))
  );
  const { data: associateRows } = associateIds.length
    ? await admin.from("associates").select("id, name").in("id", associateIds)
    : { data: [] };
  const associateNames = Object.fromEntries((associateRows ?? []).map((a) => [a.id, a.name]));
  // Include the current admin's own name so a validation stamp they set
  // during this session resolves immediately, without a full page reload.
  associateNames[associate.id] = associate.name;

  const counts = {
    industry_default: rows.filter((r) => r.provenance === "industry_default").length,
    extracted: rows.filter((r) => r.provenance === "extracted").length,
    cd_validated: rows.filter((r) => r.provenance === "cd_validated").length,
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold text-[var(--text-primary)] tracking-tight mb-1">Standards library</h1>
      <p className="text-sm text-[var(--text-secondary)] mb-4">
        CD&apos;s negotiating playbook, admin-only. Associates see individual findings during a
        review but never this list — it&apos;s the source those findings are measured against.
      </p>

      <div className="rounded-md border border-[var(--severity-medium)]/30 bg-[var(--severity-medium-bg)] px-4 py-3 mb-6 text-sm text-[var(--severity-medium)]">
        <span className="font-medium">{counts.industry_default} of {rows.length} entries</span> are still
        generic industry defaults, not CD&apos;s validated position — nothing here should be presented to an
        associate as &ldquo;how ConferenceDirect negotiates&rdquo; until a senior associate reviews it.
        {counts.extracted > 0 && ` ${counts.extracted} extracted from CD contracts (unvalidated).`}
        {counts.cd_validated > 0 && ` ${counts.cd_validated} CD-validated.`}
      </div>

      <StandardsList initialStandards={rows} associateNames={associateNames} />
    </div>
  );
}
