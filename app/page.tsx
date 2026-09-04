import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import SignOutButton from "./sign-out-button";

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
    .select("name, email, segment, is_admin")
    .eq("email", user.email)
    .maybeSingle();

  return (
    <div className="min-h-screen bg-neutral-50 px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-lg font-semibold text-neutral-900">CD Contract Reviewer</h1>
          <SignOutButton />
        </div>
        <div className="rounded border border-neutral-200 bg-white p-5">
          <p className="text-sm text-neutral-500 mb-1">Signed in as</p>
          <p className="text-base font-medium text-neutral-900">
            {associate?.name ?? user.email} {associate?.is_admin && (
              <span className="ml-2 rounded bg-neutral-900 px-1.5 py-0.5 text-xs font-normal text-white">
                admin
              </span>
            )}
          </p>
          <p className="text-sm text-neutral-500">{user.email}</p>
        </div>
        <p className="mt-6 text-sm text-neutral-500">
          Login is working. Upload and findings screens come next.
        </p>
      </div>
    </div>
  );
}
