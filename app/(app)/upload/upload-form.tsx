"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FIELD_LABEL_CLASSES, Field, FieldInput, FieldSelect } from "@/components/ui/field";
import { ContractDropZone } from "@/components/contract-drop-zone";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Body, Meta, Title } from "@/components/ui/typography";

interface OpenThread {
  id: string;
  propertyName: string;
  clientName: string | null;
  roundCount: number;
  /** The hotel's brand, when it is a listed one. Null on the default set. */
  brand: string | null;
}

/** A brand the associate can pick, and whether a review can read its standards today. */
interface BrandChoice {
  key: string;
  name: string;
  is_default: boolean;
  in_use: boolean;
}

/** What the app read off the picked contract, for the associate to confirm (app/api/analyses/read). */
interface ContractRead {
  propertyName: { value: string; evidence: string } | null;
  brand: { set: string | null; evidence: string | null; note: string | null };
  /** Every brand, the default first. */
  sets: BrandChoice[];
  chosenSet: string | null;
}

/**
 * What to say under the brand: where it was read from, and which standards
 * the review will use when the brand's own aren't switched on.
 */
function brandReason(read: ContractRead | null, sets: BrandChoice[], brand: string): string | null {
  const chosen = sets.find((s) => s.key === brand);
  const fallback = sets.find((s) => s.is_default);
  const lines: string[] = [];

  if (read?.brand.note) lines.push(read.brand.note);
  else if (read?.brand.set && read.brand.set === brand && read.brand.evidence) lines.push(`From the contract: “${read.brand.evidence}”`);
  else if (read && !read.brand.set && chosen?.is_default) lines.push("The contract names none of the listed brands.");

  if (chosen && !chosen.in_use && fallback) {
    lines.push(`${chosen.name}'s standards aren't switched on yet, so this review will use ${fallback.name}'s.`);
  }
  return lines.join(" ") || null;
}

export default function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [clientName, setClientName] = useState("");
  const [negotiationMode, setNegotiationMode] = useState<"new" | "continuing">("new");
  const [propertyName, setPropertyName] = useState("");
  const [threads, setThreads] = useState<OpenThread[]>([]);
  const [threadId, setThreadId] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const [read, setRead] = useState<ContractRead | null>(null);
  const [reading, setReading] = useState(false);
  const [sets, setSets] = useState<BrandChoice[]>([]);
  const [brand, setBrand] = useState("");

  // A name the associate typed, or a brand they picked, is theirs. A read never replaces it.
  const typedName = useRef(false);
  const pickedBrand = useRef(false);

  // Only the latest pick's read is used, when a second file is chosen before the first returns.
  const pick = useRef(0);

  useEffect(() => {
    fetch("/api/threads")
      .then((res) => res.json())
      .then((body) => setThreads(body.threads ?? []))
      .catch(() => setThreads([]));

    // The brands to list, so the field is there before a file is picked.
    fetch("/api/analyses/read")
      .then((res) => (res.ok ? res.json() : { sets: [] }))
      .then((body: { sets?: BrandChoice[] }) => {
        const listed = body.sets ?? [];
        setSets(listed);
        setBrand((current) => current || (listed.find((s) => s.is_default)?.key ?? ""));
      })
      .catch(() => setSets([]));
  }, []);

  /**
   * Reads the property name and brand off the picked file. Local rules on the
   * server, with no model call. A failed read leaves the form to be typed.
   */
  async function readContract(picked: File) {
    const mine = ++pick.current;
    setRead(null);
    setReading(true);
    try {
      const body = new FormData();
      body.append("file", picked);
      const res = await fetch("/api/analyses/read", { method: "POST", body });
      const found: ContractRead | null = res.ok ? await res.json() : null;
      if (mine !== pick.current || !found) return;

      setRead(found);
      if (found.sets.length > 0) setSets(found.sets);
      if (found.chosenSet && !pickedBrand.current) setBrand(found.chosenSet);
      if (found.propertyName && !typedName.current) setPropertyName(found.propertyName.value);
    } catch {
      // Nothing was read. The associate types the fields, as before.
    } finally {
      if (mine === pick.current) setReading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (negotiationMode === "new" && !propertyName.trim()) {
      setStatus("error");
      setErrorMessage("Property name is required for a new negotiation.");
      return;
    }
    if (negotiationMode === "continuing" && !threadId) {
      setStatus("error");
      setErrorMessage("Choose which negotiation this continues.");
      return;
    }

    setStatus("uploading");
    setErrorMessage("");

    const formData = new FormData();
    formData.append("file", file);
    if (clientName.trim()) formData.append("clientName", clientName.trim());
    formData.append("negotiationMode", negotiationMode);
    if (negotiationMode === "new") {
      formData.append("propertyName", propertyName.trim());
      if (brand) formData.append("standardsSet", brand);

      // Kept beside the confirmed values, to show how often the read was right.
      if (read?.propertyName) formData.append("readPropertyName", read.propertyName.value);
      if (read?.brand.set) formData.append("readBrandSet", read.brand.set);
    } else {
      formData.append("threadId", threadId);
    }

    try {
      const res = await fetch("/api/analyses", { method: "POST", body: formData });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus("error");
        setErrorMessage(body.error || "The upload didn't go through. Try again in a moment.");
        return;
      }

      router.push(`/analyses/${body.analysisId}`);
    } catch {
      setStatus("error");
      setErrorMessage("Upload failed. Check your connection and try again.");
    }
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-10">
      <Link href="/" className="text-sm text-[var(--text-secondary)] hover:text-[var(--cd-navy)]">
        ← Back to dashboard
      </Link>

      <Card padding="lg" className="mt-4">
        <Title className="text-[var(--text-primary)] tracking-tight mb-1">Review a contract</Title>
        <Body as="p" className="text-[var(--text-secondary)] mb-6">
          This is a negotiating aid, not legal advice. Review every finding yourself before sending anything to a
          property.
        </Body>

        <form onSubmit={handleSubmit} className="space-y-5">
          <ContractDropZone
            id="contract-file"
            file={file}
            onFile={(picked) => {
              setFile(picked);
              if (picked) {
                setStatus("idle");
                setErrorMessage("");
                readContract(picked);
              } else {
                pick.current++;
                setRead(null);
                setReading(false);
              }
            }}
            onError={(message) => {
              setStatus("error");
              setErrorMessage(message);
            }}
          />

          <fieldset>
            <legend className={FIELD_LABEL_CLASSES}>Negotiation</legend>
            <SegmentedControl
              label="Negotiation"
              options={[
                { value: "new", label: "New negotiation" },
                { value: "continuing", label: "Continuing one" },
              ]}
              value={negotiationMode}
              onChange={setNegotiationMode}
            />
          </fieldset>

          {negotiationMode === "new" ? (
            <>
              <div>
                <Field label="Property name">
                  <FieldInput
                    type="text"
                    value={propertyName}
                    onChange={(e) => {
                      typedName.current = true;
                      setPropertyName(e.target.value);
                    }}
                    placeholder="e.g. Hilton Downtown Denver"
                    required
                  />
                </Field>
                {reading && (
                  <Meta as="p" role="status" className="mt-1.5 text-[var(--text-muted)]">
                    Reading the contract…
                  </Meta>
                )}
                {!reading && read?.propertyName && (
                  <Meta as="p" className="mt-1.5 text-[var(--text-muted)]">
                    From the contract: “{read.propertyName.evidence}”
                  </Meta>
                )}
              </div>

              {sets.length > 0 && (
                <div>
                  <Field label="Hotel brand">
                    <FieldSelect
                      value={brand}
                      onChange={(e) => {
                        pickedBrand.current = true;
                        setBrand(e.target.value);
                      }}
                      required
                    >
                      {sets.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.is_default ? `${s.name} or another brand` : s.name}
                        </option>
                      ))}
                    </FieldSelect>
                  </Field>
                  {!reading && brandReason(read, sets, brand) && (
                    <Meta as="p" className="mt-1.5 text-[var(--text-muted)]">
                      {brandReason(read, sets, brand)}
                    </Meta>
                  )}
                </div>
              )}
            </>
          ) : threads.length > 0 ? (
            <Field label="Which negotiation">
              <FieldSelect value={threadId} onChange={(e) => setThreadId(e.target.value)} required>
                <option value="" disabled>
                  Choose a negotiation…
                </option>
                {threads.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.propertyName}
                    {t.clientName ? ` · ${t.clientName}` : ""}
                    {t.brand ? ` · ${t.brand}` : ""} (round {t.roundCount} so far)
                  </option>
                ))}
              </FieldSelect>
            </Field>
          ) : (
            <Meta as="p" className="text-[var(--text-muted)]">
              No open negotiations yet. Start one with &quot;New negotiation&quot; above.
            </Meta>
          )}

          <Field label="Client name" hint="(optional)">
            <FieldInput
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="e.g. Acme Association"
            />
          </Field>

          <Button
            type="submit"
            size="lg"
            fullWidth
            disabled={!file}
            loading={status === "uploading"}
            loadingText="Uploading..."
          >
            Start review
          </Button>

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
