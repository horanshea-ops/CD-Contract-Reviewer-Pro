import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import SidebarNav from "@/components/sidebar-nav";
import MobileTopBar from "@/components/mobile-top-bar";
import { ToastProvider } from "@/components/ui/toast";

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
    <ToastProvider>
      <div className="h-screen flex overflow-hidden">
        <SidebarNav associate={associate} />
        <div className="flex-1 flex flex-col min-w-0">
          <MobileTopBar associate={associate} />
          <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
