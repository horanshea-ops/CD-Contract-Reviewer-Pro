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
  /** The brand's standards the negotiation is on. Null on the default set. */
  standards: string | null;
}

/** What the app read off the picked contract, for the associate to confirm (app/api/analyses/read). */
interface ContractRead {
  propertyName: { value: string; evidence: string } | null;
  brand: { set: string | null; evidence: string | null; note: string | null };
  brandName: string | null;
  /** The sets a review can read today, the default first. */
  sets: { key: string; name: string; is_default: boolean }[];
  chosenSet: string | null;
}

/** Why the standards were preselected, in the contract's own words where there are any. */
function standardsReason(read: ContractRead): string | null {
  const fallback = read.sets.find((s) => s.is_default)?.name ?? "the default set";
  if (read.brand.note) return read.brand.note;
  if (read.brand.set && read.chosenSet === read.brand.set && read.brand.evidence) return `From the contract: “${read.brand.evidence}”`;
  if (read.brand.set && read.brandName) return `The contract names ${read.brandName}, whose standards aren't switched on, so ${fallback} is selected.`;
  return `The contract names no brand with its own standards, so ${fallback} is selected.`;
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
  const [standardsSet, setStandardsSet] = useState("");

  // A name the associate typed is theirs. A read never replaces it.
  const typedName = useRef(false);

  // Only the latest pick's read is used, when a second file is chosen before the first returns.
  const pick = useRef(0);

  useEffect(() => {
    fetch("/api/threads")
      .then((res) => res.json())
      .then((body) => setThreads(body.threads ?? []))
      .catch(() => setThreads([]));
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
      setStandardsSet(found.chosenSet ?? "");
      if (found.propertyName && !typedName.current) setPropertyName(found.propertyName.value);
    } catch {
      // Nothing was read. The associate types the fields, as before.
    } finally {
      if (mine === pick.current) setReading(false);
    }
  }

  // The standards are a choice only when more than one set is in use.
  const choosesStandards = negotiationMode === "new" && !!read && read.sets.length > 1;

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
      if (choosesStandards) formData.append("standardsSet", standardsSet);

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

              {choosesStandards && read && (
                <div>
                  <Field label="Standards">
                    <FieldSelect value={standardsSet} onChange={(e) => setStandardsSet(e.target.value)} required>
                      {read.sets.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.name}
                          {s.is_default ? " (all other hotels)" : ""}
                        </option>
                      ))}
                    </FieldSelect>
                  </Field>
                  <Meta as="p" className="mt-1.5 text-[var(--text-muted)]">
                    {standardsReason(read)}
                  </Meta>
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
                    {t.standards ? ` · ${t.standards} standards` : ""} (round {t.roundCount} so far)
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
