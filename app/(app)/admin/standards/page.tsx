import { redirect } from "next/navigation";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { Title } from "@/components/ui/typography";
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

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Title className="text-[var(--text-primary)] tracking-tight mb-6">Standards library</Title>

      <StandardsList initialStandards={rows} associateNames={associateNames} />
    </div>
  );
}
