"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Field, FieldInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Body, Title } from "@/components/ui/typography";
import { ORG } from "@/lib/org";

const REDIRECT_ERRORS: Record<string, string> = {
  not_authorized:
    "That email isn't on the associate list yet. Ask your admin to add it, then try again.",
  auth_failed: "That login link didn't work. It may have expired, so request a new one below.",
};

function RedirectError() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  if (!error || !REDIRECT_ERRORS[error]) return null;
  return (
    <Body
      as="p"
      role="alert"
      className="mb-4 rounded-md border border-[color:var(--severity-medium)]/30 bg-[var(--severity-medium-bg)] px-3 py-2 text-[var(--severity-medium)]"
    >
      {REDIRECT_ERRORS[error]}
    </Body>
  );
}

const BAD_PASSWORD =
  "That email and password don't match. If you haven't set a password yet, sign in with an emailed link below, then set one.";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "link">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  function fail(message: string) {
    setStatus("error");
    setErrorMessage(message);
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      fail(error.code === "invalid_credentials" ? BAD_PASSWORD : error.message);
      return;
    }

    // Signing in proves the password. Using the app also needs an active
    // associate row, and the route signs the session out when there isn't one.
    const res = await fetch("/api/auth/verify-allowlist").catch(() => null);
    if (!res?.ok) {
      fail(res?.status === 403 ? REDIRECT_ERRORS.not_authorized : "Sign-in didn't finish. Try again.");
      return;
    }

    router.replace("/");
    router.refresh();
  }

  async function handleLinkSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/account`,
      },
    });

    if (error) {
      fail(error.message);
      return;
    }

    setStatus("sent");
  }

  function switchMode(next: "password" | "link") {
    setMode(next);
    setStatus("idle");
    setErrorMessage("");
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
            {ORG.shortName}
          </span>
          <span className="text-white font-semibold tracking-tight">Contract Reviewer</span>
        </div>
        <div className="relative">
          <Title as="h2" className="text-white leading-tight mb-3">
            Every finding is a candidate for review, never a clearance.
          </Title>
          <Body as="p" className="text-[var(--cd-blue-light)] max-w-sm">
            A negotiating aid for {ORG.name} associates, measured against how {ORG.shortName} actually negotiates,
            not generic industry defaults.
          </Body>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 bg-white">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <span className="flex h-8 w-8 items-center justify-center rounded bg-[var(--cd-navy)] text-white text-sm font-bold">
              {ORG.shortName}
            </span>
            <span className="text-[var(--text-primary)] font-semibold tracking-tight">Contract Reviewer</span>
          </div>

          <Title className="text-[var(--text-primary)] tracking-tight mb-1">Sign in</Title>
          <Body as="p" className="text-[var(--text-secondary)] mb-6">
            {mode === "password"
              ? `Use your ${ORG.name} email and password.`
              : "We'll email you a sign-in link. After you sign in, you can set a new password."}
          </Body>

          <Suspense fallback={null}>
            <RedirectError />
          </Suspense>

          {status === "sent" ? (
            <Body
              as="div"
              role="status"
              aria-live="polite"
              className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-4 text-[var(--text-primary)]"
            >
              Check <span className="font-medium">{email}</span> for a sign-in link. It expires in a few minutes.
            </Body>
          ) : (
            <form onSubmit={mode === "password" ? handlePasswordSubmit : handleLinkSubmit} className="space-y-3">
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
              {mode === "password" && (
                <Field label="Password">
                  <FieldInput
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
              )}
              <Button
                type="submit"
                fullWidth
                loading={status === "sending"}
                loadingText={mode === "password" ? "Signing in..." : "Sending..."}
              >
                {mode === "password" ? "Sign in" : "Email me a sign-in link"}
              </Button>
              {status === "error" && (
                <Body as="p" role="alert" className="text-[var(--severity-high)]">
                  {errorMessage}
                </Body>
              )}
            </form>
          )}

          <button
            type="button"
            onClick={() => switchMode(mode === "password" ? "link" : "password")}
            className="mt-4 text-sm text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--cd-navy)]"
          >
            {mode === "password" ? "Forgot your password? Email me a sign-in link" : "Sign in with a password instead"}
          </button>
        </div>
      </div>
    </div>
  );
}
