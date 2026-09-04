import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import SignOutButton from "./sign-out-button";

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  processing: "Analyzing...",
  complete: "Complete",
  failed: "Failed",
};

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const admin = createAdminClient();
  const { data: associate } = await admin
    .from("associates")
    .select("id, name, email, segment, is_admin")
    .eq("email", user.email)
    .maybeSingle();

  const { data: recentAnalyses } = associate
    ? await admin
        .from("analyses")
        .select("id, filename, status, created_at, client_id, clients(name)")
        .eq("associate_id", associate.id)
        .order("created_at", { ascending: false })
        .limit(15)
    : { data: [] };

  return (
    <div className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-neutral-900">CD Contract Reviewer</h1>
            <p className="text-sm text-neutral-500">
              {associate?.name ?? user.email}
              {associate?.is_admin && (
                <span className="ml-2 rounded bg-neutral-900 px-1.5 py-0.5 text-xs font-normal text-white">
                  admin
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {associate?.is_admin && (
              <Link href="/admin/standards" className="text-sm text-neutral-500 hover:text-neutral-900">
                Standards library
              </Link>
            )}
            <SignOutButton />
          </div>
        </div>

        <Link
          href="/upload"
          className="block w-full text-center rounded bg-neutral-900 text-white text-sm font-medium py-2.5 mb-8"
        >
          Review a new contract
        </Link>

        <h2 className="text-sm font-semibold text-neutral-700 mb-3">Your recent analyses</h2>
        {!recentAnalyses || recentAnalyses.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing yet — upload a contract to get started.</p>
        ) : (
          <div className="space-y-2">
            {recentAnalyses.map((a) => (
              <Link
                key={a.id}
                href={`/analyses/${a.id}`}
                className="flex items-center justify-between rounded border border-neutral-200 bg-white px-4 py-3 hover:border-neutral-400"
              >
                <div>
                  <p className="text-sm font-medium text-neutral-900">{a.filename}</p>
                  <p className="text-xs text-neutral-500">
                    {(a.clients as unknown as { name: string } | null)?.name ?? "No client specified"} ·{" "}
                    {new Date(a.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span
                  className={`text-xs font-medium rounded px-2 py-1 ${
                    a.status === "failed"
                      ? "bg-red-50 text-red-700"
                      : a.status === "complete"
                        ? "bg-neutral-100 text-neutral-700"
                        : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {STATUS_LABEL[a.status] ?? a.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
