"use client";

import { useId, type ReactNode } from "react";

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  /** Render-prop receiving the ids to wire onto the control. */
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/**
 * Accessible field wrapper: associates a label, optional hint, and error
 * message with the control via aria-describedby / aria-invalid.
 */
export function Field({ label, error, hint, required, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {required ? <span className="ms-1 text-destructive" aria-hidden="true">*</span> : null}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
