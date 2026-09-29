import { redirect } from "next/navigation";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import { historicalExtractionEnabled, type HistoricalContract } from "@/lib/historical/types";
import { AdminHeader } from "@/components/admin-tabs";
import HistoricalContracts from "./historical-contracts";

export default async function AdminContractsPage() {
  const associate = await getCurrentAssociate();
  if (!associate) redirect("/login");
  if (!associate.is_admin) redirect("/");

  const db = createAdminClient();
  const [{ data: contracts }, { data: associates }] = await Promise.all([
    db.from("historical_contracts").select("*").order("created_at", { ascending: false }),
    db.from("associates").select("id, name, status").order("name", { ascending: true }),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <AdminHeader />
      <HistoricalContracts
        initial={(contracts ?? []) as HistoricalContract[]}
        associates={(associates ?? []).map((a) => ({ id: a.id, name: a.name, active: a.status === "active" }))}
        extractionOn={historicalExtractionEnabled()}
      />
    </div>
  );
}
