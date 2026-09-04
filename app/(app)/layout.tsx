import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import NavBar from "@/components/nav-bar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
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
    .select("name, email, is_admin")
    .eq("email", user.email)
    .maybeSingle();

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar associate={associate} />
      <div className="flex-1">{children}</div>
    </div>
  );
}
