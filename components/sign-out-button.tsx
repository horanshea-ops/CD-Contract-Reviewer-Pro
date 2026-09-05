"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export default function SignOutButton({ iconOnly }: { iconOnly?: boolean }) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  if (iconOnly) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={handleSignOut}
        aria-label="Sign out"
        title="Sign out"
        className="!px-2"
      >
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M8 4H5a1 1 0 00-1 1v10a1 1 0 001 1h3M13 13l3-3-3-3M6 10h10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Button>
    );
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleSignOut}>
      Sign out
    </Button>
  );
}
