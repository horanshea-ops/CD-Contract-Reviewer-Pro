"use client";

import { useRef, useState } from "react";
import { FIELD_LABEL_CLASSES } from "@/components/ui/field";
import { Body, Meta } from "@/components/ui/typography";
import { cn } from "@/lib/cn";

const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".doc"];
const UNSUPPORTED_TYPE_MESSAGE = "Unsupported file type. Upload a PDF, DOCX, or DOC contract.";
export const MAX_CONTRACT_BYTES = 32 * 1024 * 1024;

// Drag-and-drop bypasses the file input's `accept` filter entirely, and a
// dropped file's `type` can be empty depending on OS/browser — checking the
// extension is what actually works for both paths.
function hasAcceptedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function problemWith(file: File): string | null {
  if (!hasAcceptedExtension(file.name)) return UNSUPPORTED_TYPE_MESSAGE;
  if (file.size > MAX_CONTRACT_BYTES) return `This file is ${formatFileSize(file.size)}. The limit is 32MB.`;
  return null;
}

/** Sorts picked files into ones to upload and ones to skip, with the reason for each skip. */
export function sortContractFiles(files: File[]): { accepted: File[]; rejected: { name: string; reason: string }[] } {
  const accepted: File[] = [];
  const rejected: { name: string; reason: string }[] = [];
  for (const file of files) {
    const problem = problemWith(file);
    if (problem) rejected.push({ name: file.name, reason: problem });
    else accepted.push(file);
  }
  return { accepted, rejected };
}

/**
 * The contract picker shared by New review and the Admin tab's historical
 * uploads: a drop zone that also opens the file browser, checking type and size
 * either way. With `onFiles`, it takes many files at once.
 */
export function ContractDropZone({
  id,
  label = "Contract",
  file,
  onFile,
  onFiles,
  onError,
}: {
  id: string;
  label?: string;
  file?: File | null;
  onFile?: (file: File | null) => void;
  /** Takes many files, passed on unchecked. */
  onFiles?: (files: File[]) => void;
  onError?: (message: string) => void;
}) {
  const [dragActive, setDragActive] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const multiple = !!onFiles;

  function acceptMany(list: FileList | null | undefined) {
    if (list?.length) onFiles!(Array.from(list));
    if (fileInput.current) fileInput.current.value = "";
  }

  function accept(picked: File | null, list?: FileList) {
    if (!onFile) return;
    if (!picked) return onFile(null);
    const problem = problemWith(picked);
    if (problem) {
      onFile(null);
      onError?.(problem);
      return;
    }
    onFile(picked);
    // Keep the input in step with a dropped file, or its `required` check
    // would block a submit the page itself considers ready.
    if (list && fileInput.current) fileInput.current.files = list;
  }

  return (
    <div>
      <label htmlFor={id} className={FIELD_LABEL_CLASSES}>
        {label}
      </label>
      <input
        ref={fileInput}
        id={id}
        type="file"
        accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
        required={!multiple}
        multiple={multiple}
        onChange={(e) => (multiple ? acceptMany(e.target.files) : accept(e.target.files?.[0] ?? null))}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragActive(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          if (multiple) return acceptMany(e.dataTransfer.files);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) accept(dropped, e.dataTransfer.files);
        }}
        className={cn(
          "flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-4 py-5 text-center transition-colors",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--cd-blue)]",
          dragActive
            ? "border-[var(--cd-blue)] bg-[var(--cd-blue-pale)]"
            : "border-[var(--border-strong)] hover:bg-[var(--surface-muted)]"
        )}
      >
        {file ? (
          <>
            <Body as="span" className="font-medium text-[var(--text-primary)] break-all">
              {file.name}
            </Body>
            <Meta as="span" className="text-[var(--text-muted)]">
              {formatFileSize(file.size)} · <span className="text-[var(--cd-navy)] underline">Change</span>
            </Meta>
          </>
        ) : (
          <>
            <Body as="span" className="text-[var(--text-primary)]">
              Drop {multiple ? "contracts" : "a contract"} here, or{" "}
              <span className="font-medium text-[var(--cd-navy)] underline">browse</span>
            </Body>
            <Meta as="span" className="text-[var(--text-muted)]">
              PDF, DOCX or DOC, up to 32MB{multiple ? " each. Select as many as you like." : ""}
            </Meta>
          </>
        )}
      </label>
    </div>
  );
}
