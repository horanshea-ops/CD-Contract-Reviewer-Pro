"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
    <p className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
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
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold text-neutral-900 mb-1">CD Contract Reviewer</h1>
        <p className="text-sm text-neutral-500 mb-6">
          Sign in with your ConferenceDirect email. We&apos;ll send you a login link — no password needed.
        </p>

        <Suspense fallback={null}>
          <RedirectError />
        </Suspense>

        {status === "sent" ? (
          <div className="rounded border border-neutral-200 bg-white p-4 text-sm text-neutral-700">
            Check <span className="font-medium">{email}</span> for a login link. It expires in a
            few minutes.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@conferencedirect.com"
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full rounded bg-neutral-900 text-white text-sm font-medium py-2 disabled:opacity-50"
            >
              {status === "sending" ? "Sending..." : "Send login link"}
            </button>
            {status === "error" && (
              <p className="text-sm text-red-600">{errorMessage}</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
