"use client";

import { useState } from "react";
import Link from "next/link";
import { Field, FieldInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Body, Title } from "@/components/ui/typography";
import { MIN_PASSWORD_LENGTH, passwordProblem } from "@/lib/password-rules";

export default function AccountPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const problem = passwordProblem(password, confirm);
    if (problem) {
      setStatus("error");
      setErrorMessage(problem);
      return;
    }

    setStatus("saving");
    const res = await fetch("/api/associates/me/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, confirm }),
    }).catch(() => null);

    if (!res?.ok) {
      const body = await res?.json().catch(() => ({}));
      setStatus("error");
      setErrorMessage(body?.error ?? "Could not save the password. Try again.");
      return;
    }

    setPassword("");
    setConfirm("");
    setStatus("saved");
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <Link href="/" className="text-sm text-[var(--text-secondary)] hover:text-[var(--cd-navy)]">
        ← Back to dashboard
      </Link>

      <Card padding="lg" className="mt-4">
        <Title className="text-[var(--text-primary)] tracking-tight mb-1">Password</Title>
        <Body as="p" className="text-[var(--text-secondary)] mb-6">
          Set a password to sign in with your email and password. Use at least {MIN_PASSWORD_LENGTH} characters.
        </Body>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="New password">
            <FieldInput
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="Type it again">
            <FieldInput
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <Button type="submit" loading={status === "saving"} loadingText="Saving...">
            Save password
          </Button>
          {status === "saved" && (
            <Body as="p" role="status" className="text-[var(--text-primary)]">
              Password saved. Use it next time you sign in.
            </Body>
          )}
          {status === "error" && (
            <Body as="p" role="alert" className="text-[var(--severity-high)]">
              {errorMessage}
            </Body>
          )}
        </form>
      </Card>
    </div>
  );
}
