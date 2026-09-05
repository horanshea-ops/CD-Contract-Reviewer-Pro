"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Lands here after clicking a login link. Handles both shapes Supabase can
 * send back: a `?code=` (PKCE — what happens when signInWithOtp was called
 * from this app's own /login page) or `#access_token=...` in the URL
 * fragment (implicit flow — what admin-generated dev/testing links produce,
 * since there's no browser-stored PKCE verifier to pair with). The browser
 * client auto-detects and completes either one; we just need to wait for it,
 * then confirm the email is on the allowlist before letting them in.
 */
export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function finishLogin() {
      const supabase = createClient();

      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      if (code) {
        await supabase.auth.exchangeCodeForSession(code);
      }

      // @supabase/ssr's browser client doesn't auto-parse hash-fragment
      // tokens (the implicit flow) — only exchangeCodeForSession above is
      // automatic. Handle the hash explicitly so links generated outside a
      // browser (no stored PKCE verifier) still work.
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      if (accessToken && refreshToken) {
        await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (cancelled) return;

      if (!session) {
        router.replace("/login?error=auth_failed");
        return;
      }

      const res = await fetch("/api/auth/verify-allowlist");
      if (cancelled) return;

      if (res.ok) {
        router.replace("/");
      } else {
        const body = await res.json().catch(() => ({}));
        router.replace(
          body.reason === "not_on_allowlist"
            ? "/login?error=not_authorized"
            : "/login?error=auth_failed"
        );
      }
    }

    // An expired/invalid magic-link code makes exchangeCodeForSession reject —
    // exactly the case the auth_failed error copy exists for. Without this,
    // that rejection would throw inside the effect and strand the user on
    // "Signing you in..." forever, since the code below it never runs.
    finishLogin().catch(() => {
      if (!cancelled) router.replace("/login?error=auth_failed");
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <p className="text-sm text-[var(--text-secondary)]">Signing you in...</p>
    </div>
  );
}
