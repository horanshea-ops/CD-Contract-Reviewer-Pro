import { redirect } from "next/navigation";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { Title } from "@/components/ui/typography";
import { SET_COLUMNS, type StandardSet } from "@/lib/standards/sets";
import StandardsList, { type StandardRow } from "./standards-list";

export default async function StandardsAdminPage({ searchParams }: { searchParams: Promise<{ set?: string }> }) {
  const associate = await getCurrentAssociate();
  if (!associate) redirect("/login");
  if (!associate.is_admin) redirect("/");

  const admin = createAdminClient();
  const [{ data: setRows }, { data: standards }] = await Promise.all([
    admin.from("standard_sets").select(SET_COLUMNS).order("is_default", { ascending: false }).order("name", { ascending: true }),
    admin.from("standards").select("*").order("clause_type", { ascending: true }),
  ]);

  // The set named in the address, or the default. With no sets in the database the whole library shows, as it did before sets.
  const sets = (setRows ?? []) as StandardSet[];
  const wanted = (await searchParams).set;
  const set = sets.find((s) => s.key === wanted) ?? sets.find((s) => s.is_default) ?? null;

  const rows = ((standards ?? []) as (StandardRow & { set_key?: string })[]).filter((row) => !set || row.set_key === set.key);

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

      <StandardsList key={set?.key ?? "all"} initialStandards={rows} associateNames={associateNames} sets={sets} initialSet={set} />
    </div>
  );
}
