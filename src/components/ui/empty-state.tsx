import type { ReactNode } from "react";
import type { IconName } from "./icon";
import { StatePanel } from "./state-panel";

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  /** Required: an empty state always offers a next step. */
  readonly action: ReactNode;
  readonly icon?: IconName;
}

export function EmptyState({ title, description, action, icon = "inbox" }: EmptyStateProps) {
  return <StatePanel tone="neutral" icon={icon} title={title} description={description} action={action} />;
}
