import { useId, type ReactNode } from "react";

export interface FieldIds {
  readonly id: string;
  readonly hintId: string | undefined;
  readonly errorId: string | undefined;
  /** Pass straight to `aria-describedby` on the control. */
  readonly describedBy: string | undefined;
}

/**
 * Computes the id and `aria-describedby` wiring shared by every labelled form control
 * (`Input`, `Select`, …). One place decides how hint/error ids are derived so the contract
 * can't drift between controls.
 */
export function useFieldIds(id: string | undefined, hint: string | undefined, error: string | undefined): FieldIds {
  const autoId = useId();
  const resolvedId = id ?? autoId;
  const hintId = hint ? `${resolvedId}-hint` : undefined;
  const errorId = error ? `${resolvedId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return { id: resolvedId, hintId, errorId, describedBy };
}

export interface FieldShellProps {
  readonly id: string;
  /** Required: every control in this product has a visible label. */
  readonly label: string;
  readonly hint?: string;
  readonly hintId?: string;
  readonly error?: string;
  readonly errorId?: string;
  readonly children: ReactNode;
}

/**
 * The label + control + hint/error wrapper shared by every labelled form control. Renders
 * the label, the control itself (as `children`), and then the hint and/or error text,
 * matching `Input`'s original layout exactly so extracting this changed no behavior.
 */
export function FieldShell({ id, label, hint, hintId, error, errorId, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-text-primary">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={hintId} className="text-sm text-text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}
    </div>
  );
}
