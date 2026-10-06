import { redirect } from "next/navigation";
import { getCurrentAssociate } from "@/lib/current-associate";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AssociateRow } from "@/lib/associates";
import { historicalContractsEnabled } from "@/lib/historical/types";
import { AdminHeader } from "@/components/admin-tabs";
import UsersList from "./users-list";

export default async function AdminUsersPage() {
  const associate = await getCurrentAssociate();
  if (!associate) redirect("/login");
  if (!associate.is_admin) redirect("/");

  const db = createAdminClient();
  const [{ data: associates }, { data: logins }] = await Promise.all([
    db.from("associates").select("id, name, email, is_admin, status, created_at").order("name", { ascending: true }),
    db.from("audit_log").select("actor_id, created_at").eq("action", "login").order("created_at", { ascending: false }).limit(2000),
  ]);

  // The newest login row per associate, since rows arrive newest first.
  const lastSignIn: Record<string, string> = {};
  for (const row of logins ?? []) {
    if (row.actor_id && !lastSignIn[row.actor_id]) lastSignIn[row.actor_id] = row.created_at;
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <AdminHeader historical={historicalContractsEnabled()} />
      <UsersList initial={(associates ?? []) as AssociateRow[]} lastSignIn={lastSignIn} selfId={associate.id} />
    </div>
  );
}
