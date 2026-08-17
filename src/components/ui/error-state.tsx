import type { ReactNode } from "react";
import { Icon } from "./icon";

export interface ErrorStateProps {
  readonly title: string;
  readonly description?: string;
  /** Required: an error state always offers a way forward (retry, go back, contact support). */
  readonly action: ReactNode;
}

export function ErrorState({ title, description, action }: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-lg border border-negative/40 bg-surface-elevated p-8 text-center">
      <Icon name="alert-triangle" size={28} className="text-negative" />
      <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
      {description ? <p className="max-w-prose text-sm text-text-muted">{description}</p> : null}
      <div>{action}</div>
    </div>
  );
}
