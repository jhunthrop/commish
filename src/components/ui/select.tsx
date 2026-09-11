import { forwardRef, type SelectHTMLAttributes } from "react";
import { FieldShell, useFieldIds } from "./field-shell";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "id" | "children"> {
  /** Required: every control in this product has a visible label. */
  readonly label: string;
  readonly options: readonly SelectOption[];
  readonly error?: string;
  readonly hint?: string;
  readonly id?: string;
}

/**
 * A native `<select>` with `Input`'s exact label/hint/error contract. Deliberately not a
 * custom listbox: the platform control is already keyboard- and screen-reader-complete on
 * every device we support, including the 360px phone baseline.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, error, hint, id: givenId, className = "", ...rest },
  ref,
) {
  const { id, hintId, errorId, describedBy } = useFieldIds(givenId, hint, error);
  return (
    <FieldShell id={id} label={label} hint={hint} hintId={hintId} error={error} errorId={errorId}>
      <select
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        // SIDELINE (2026-09-10): `Input`'s 40px pill, verbatim — a form mixing the two is one
        // field shape, not two.
        className={
          "h-10 rounded-pill border bg-surface-elevated px-4 text-md text-text-primary " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
          "disabled:opacity-60 disabled:cursor-not-allowed " +
          // `border-edge`, never `border-line`: a select is a control a user must find, not a
          // decorative hairline between two surfaces (D1, lobby review 2026-08-26 — the same
          // "edge bounds, line separates" rule `Button`'s quiet pill and
          // `AdvancedSettingsDrawer`'s `<details>` already hold).
          (error ? "border-negative " : "border-edge ") +
          className
        }
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
});
