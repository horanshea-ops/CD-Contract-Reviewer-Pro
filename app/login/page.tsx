"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Field, FieldInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

const REDIRECT_ERRORS: Record<string, string> = {
  not_authorized:
    "That email isn't on the associate list yet. Ask your admin to add it, then try again.",
  auth_failed: "That login link didn't work — it may have expired. Request a new one below.",
};

function RedirectError() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  if (!error || !REDIRECT_ERRORS[error]) return null;
  return (
    <p
      role="alert"
      className="mb-4 rounded-md border border-[color:var(--severity-medium)]/30 bg-[var(--severity-medium-bg)] px-3 py-2 text-sm text-[var(--severity-medium)]"
    >
      {REDIRECT_ERRORS[error]}
    </p>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    setStatus("sent");
  }

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-1/2 bg-[var(--cd-navy-darker)] relative overflow-hidden flex-col justify-between p-12">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(circle at 30% 20%, var(--cd-blue) 0%, transparent 45%), radial-gradient(circle at 80% 80%, var(--cd-blue-light) 0%, transparent 40%)",
          }}
        />
        <div className="relative flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded bg-white text-[var(--cd-navy)] text-sm font-bold">
            CD
          </span>
          <span className="text-white font-semibold tracking-tight">Contract Reviewer</span>
        </div>
        <div className="relative">
          <h2 className="text-3xl font-semibold text-white leading-tight mb-3">
            Every finding is a candidate for review, never a clearance.
          </h2>
          <p className="text-[var(--cd-blue-light)] text-sm max-w-sm">
            A negotiating aid for ConferenceDirect associates — measured against how CD actually
            negotiates, not generic industry defaults.
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 bg-white">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <span className="flex h-8 w-8 items-center justify-center rounded bg-[var(--cd-navy)] text-white text-sm font-bold">
              CD
            </span>
            <span className="text-[var(--text-primary)] font-semibold tracking-tight">Contract Reviewer</span>
          </div>

          <h1 className="text-2xl font-semibold text-[var(--text-primary)] tracking-tight mb-1">Sign in</h1>
          <p className="text-sm text-[var(--text-secondary)] mb-6">
            Use your ConferenceDirect email. We&apos;ll send you a login link — no password needed.
          </p>

          <Suspense fallback={null}>
            <RedirectError />
          </Suspense>

          {status === "sent" ? (
            <div
              role="status"
              aria-live="polite"
              className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-sm text-[var(--text-primary)]"
            >
              Check <span className="font-medium">{email}</span> for a login link. It expires in a
              few minutes.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <Field label="Email">
                <FieldInput
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@conferencedirect.com"
                />
              </Field>
              <Button type="submit" fullWidth loading={status === "sending"} loadingText="Sending...">
                Send login link
              </Button>
              {status === "error" && (
                <p role="alert" className="text-sm text-[var(--severity-high)]">
                  {errorMessage}
                </p>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
