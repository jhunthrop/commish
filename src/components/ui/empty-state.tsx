import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  /** Required: an empty state always offers a next step. */
  readonly action: ReactNode;
  readonly icon?: IconName;
}

export function EmptyState({ title, description, action, icon = "inbox" }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Icon name={icon} size={28} className="text-text-muted" />
      <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
      {description ? <p className="max-w-prose text-sm text-text-muted">{description}</p> : null}
      <div>{action}</div>
    </div>
  );
}
