import { forwardRef, type InputHTMLAttributes } from "react";
import { FieldShell, useFieldIds } from "./field-shell";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  readonly label: string;
  readonly error?: string;
  readonly hint?: string;
  readonly id?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, id: givenId, className = "", ...rest },
  ref,
) {
  const { id, hintId, errorId, describedBy } = useFieldIds(givenId, hint, error);
  return (
    <FieldShell id={id} label={label} hint={hint} hintId={hintId} error={error} errorId={errorId}>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        // SIDELINE (2026-09-10): the mock's 40px PILL field. `h-10` was already 40; what moved
        // is the radius (`shape.button`, the same pill every control in this system wears) and
        // the gutter, because text set flush against a pill's curve reads as clipped.
        className={
          "h-10 rounded-pill border bg-surface-elevated px-4 text-md text-text-primary " +
          "placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
          "disabled:opacity-60 disabled:cursor-not-allowed " +
          // `border-edge`, never `border-line`: an input is a control a user must find, not a
          // decorative hairline (D1, lobby review 2026-08-26).
          (error ? "border-negative " : "border-edge ") +
          className
        }
        {...rest}
      />
    </FieldShell>
  );
});
