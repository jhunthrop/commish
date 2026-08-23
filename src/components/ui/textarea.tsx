"use client";

import { forwardRef, useId, useState, type ChangeEvent, type TextareaHTMLAttributes } from "react";
import { FieldShell, useFieldIds } from "./field-shell";

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "maxLength"> {
  readonly label: string;
  readonly error?: string;
  readonly hint?: string;
  readonly id?: string;
  /** When set, renders a live remaining-character count below the control. */
  readonly maxLength?: number;
}

/**
 * The multi-line sibling of `Input`, built on the same `FieldShell`/`useFieldIds` so label,
 * hint, error and `aria-describedby` behave identically — a form mixing `Input` and `Textarea`
 * fields is one accessibility contract, not two.
 *
 * The remaining-character count is wired into `aria-describedby` alongside hint/error (so a
 * screen reader user can find it the same way they find either), but announced politely
 * (`aria-live="polite"`) rather than on every keystroke: an `aria-live="assertive"` region here
 * would interrupt a screen reader mid-sentence for every single character typed, which is worse
 * than not announcing it at all. `aria-atomic` keeps each announcement the whole current count,
 * not a stale fragment.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, id: givenId, maxLength, className = "", value, defaultValue, onChange, ...rest },
  ref,
) {
  const { id, hintId, errorId, describedBy: fieldDescribedBy } = useFieldIds(givenId, hint, error);
  const countId = useId();
  const describedBy = maxLength === undefined ? fieldDescribedBy : [fieldDescribedBy, countId].filter(Boolean).join(" ");

  const initialLength = typeof value === "string" ? value.length : typeof defaultValue === "string" ? defaultValue.length : 0;
  const [length, setLength] = useState(initialLength);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setLength(event.target.value.length);
    onChange?.(event);
  };

  const remaining = maxLength === undefined ? null : maxLength - (value !== undefined && typeof value === "string" ? value.length : length);

  return (
    <FieldShell id={id} label={label} hint={hint} hintId={hintId} error={error} errorId={errorId}>
      <textarea
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        value={value}
        defaultValue={defaultValue}
        onChange={handleChange}
        className={
          "min-h-28 resize-y rounded-md border bg-surface-elevated px-3 py-2 text-md text-text-primary " +
          "placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
          "disabled:opacity-60 disabled:cursor-not-allowed " +
          (error ? "border-negative " : "border-line ") +
          className
        }
        {...rest}
      />
      {remaining === null ? null : (
        <p id={countId} aria-live="polite" aria-atomic="true" className="text-sm text-text-muted">
          {remaining < 0 ? `${Math.abs(remaining)} over the limit` : `${remaining} characters left`}
        </p>
      )}
    </FieldShell>
  );
});
