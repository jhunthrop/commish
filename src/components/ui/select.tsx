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
        className={
          "h-10 rounded-md border bg-surface-elevated px-3 text-md text-text-primary " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
          "disabled:opacity-60 disabled:cursor-not-allowed " +
          (error ? "border-negative " : "border-border ") +
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
