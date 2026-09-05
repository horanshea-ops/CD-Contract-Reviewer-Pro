"use client";

import { createContext, useContext, useId } from "react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
}

const FieldContext = createContext<FieldContextValue | null>(null);

function useFieldContext(componentName: string): FieldContextValue {
  const ctx = useContext(FieldContext);
  if (!ctx) {
    throw new Error(`${componentName} must be rendered inside a <Field>`);
  }
  return ctx;
}

/**
 * Label + hint + error wrapper that wires `htmlFor`/`id`/`aria-describedby`
 * for whatever control is nested inside — makes correct label association
 * structural instead of a manual pairing every screen has to remember.
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-[var(--text-primary)] mb-1">
        {label}
        {hint && (
          <span id={hintId} className="text-[var(--text-muted)] font-normal ml-1">
            {hint}
          </span>
        )}
      </label>
      <FieldContext.Provider value={{ id, describedBy }}>{children}</FieldContext.Provider>
      {error && (
        <p id={errorId} role="alert" className="text-xs text-[var(--severity-high)] mt-1">
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL_CLASSES =
  "w-full rounded-md border border-[var(--border-strong)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--cd-blue)]";

// Native file inputs can't take the same border/padding treatment as a text
// control (their visible surface is the `file:*` pseudo-element "button"),
// so this gets its own base class rather than forcing CONTROL_CLASSES onto it.
const FILE_CONTROL_CLASSES =
  "block w-full text-sm text-[var(--text-secondary)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--cd-navy)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-white file:cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-blue)]";

export function FieldInput({ className, type, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  const { id, describedBy } = useFieldContext("FieldInput");
  const base = type === "file" ? FILE_CONTROL_CLASSES : CONTROL_CLASSES;
  return <input id={id} type={type} aria-describedby={describedBy} className={cn(base, className)} {...rest} />;
}

export function FieldTextarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { id, describedBy } = useFieldContext("FieldTextarea");
  return <textarea id={id} aria-describedby={describedBy} className={cn(CONTROL_CLASSES, className)} {...rest} />;
}

export function FieldSelect({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  const { id, describedBy } = useFieldContext("FieldSelect");
  return (
    <select id={id} aria-describedby={describedBy} className={cn(CONTROL_CLASSES, className)} {...rest}>
      {children}
    </select>
  );
}
