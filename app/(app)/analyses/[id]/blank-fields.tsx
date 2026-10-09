"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldInput } from "@/components/ui/field";
import { Meta } from "@/components/ui/typography";
import { blankContext, blanksIn, fillBlanks } from "@/lib/redline-engine/wording";

/**
 * One field for each blank in a change's wording.
 *
 * The model writes a blank such as "[X]" where it lacks a figure, and only the
 * associate can supply it. Saving records the filled wording as an edit, which
 * accepts the change.
 */
export default function BlankFields({
  language,
  quote,
  saving,
  onSave,
}: {
  language: string;
  quote: string | null;
  saving: boolean;
  onSave: (filled: string) => void;
}) {
  const blanks = blanksIn(language, quote);
  const [values, setValues] = useState<string[]>(() => blanks.map(() => ""));
  const [error, setError] = useState("");

  function save() {
    const filled = fillBlanks(language, quote, values);
    if (!filled) return;
    if (blanksIn(filled, quote).length > 0) {
      setError("The wording would still hold a blank. Type the value itself, or use Edit to rewrite the wording.");
      return;
    }
    onSave(filled);
  }

  return (
    <div className="mt-3 space-y-2 rounded-md border border-[var(--border)] px-3 py-2.5">
      <Meta as="p" className="font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        {blanks.length === 1 ? "Fill in the blank" : "Fill in the blanks"}
      </Meta>
      {blanks.map((blank, i) => {
        const { before, after } = blankContext(language, blank);
        return (
          <Field
            key={blank.start}
            label={
              <span className="font-normal text-[var(--text-secondary)]">
                {before}
                <span className="font-semibold text-[var(--text-primary)]">{language.slice(blank.start, blank.end)}</span>
                {after}
              </span>
            }
          >
            <FieldInput
              type="text"
              value={values[i] ?? ""}
              onChange={(e) => {
                setError("");
                setValues((prev) => prev.map((v, at) => (at === i ? e.target.value : v)));
              }}
            />
          </Field>
        );
      })}
      {error && (
        <Meta as="p" role="alert" className="text-[var(--severity-high)]">
          {error}
        </Meta>
      )}
      <Button size="sm" onClick={save} disabled={values.some((v) => !v.trim())} loading={saving} loadingText="Saving...">
        Save and accept
      </Button>
    </div>
  );
}
