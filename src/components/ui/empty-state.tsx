import type { ReactNode } from "react";
import type { IconName } from "./icon";
import { Mascot } from "./mascot";
import { StatePanel } from "./state-panel";

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string;
  /** Required: an empty state always offers a next step. */
  readonly action: ReactNode;
  readonly icon?: IconName;
  /**
   * V6's mascot slot: the practice bot stands in for the icon and the empty state becomes a
   * moment instead of an absence (the warmth pass; see `./mascot.tsx` for where he may and may
   * not appear). Opt-in per call site — a mascot beside every empty table would stop being one.
   */
  readonly mascot?: boolean;
}

export function EmptyState({ title, description, action, icon = "inbox", mascot = false }: EmptyStateProps) {
  return (
    <StatePanel
      tone="neutral"
      icon={icon}
      title={title}
      description={description}
      action={action}
      visual={mascot ? <Mascot /> : undefined}
    />
  );
}
