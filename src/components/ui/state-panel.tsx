import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export type StatePanelTone = "neutral" | "negative";

export interface StatePanelProps {
  readonly tone: StatePanelTone;
  readonly icon: IconName;
  readonly title: string;
  readonly description?: string;
  /** Required: a state panel always offers a next step. */
  readonly action: ReactNode;
  readonly role?: "alert";
  /** Replaces the icon — `EmptyState`'s mascot slot rides through here. */
  readonly visual?: ReactNode;
}

/**
 * V6 (the warmth pass): `neutral`'s dashed hairline — the old "empty lot" fence — becomes the
 * soft resting fill, the same material every card took. `negative` KEEPS its border: an error's
 * boundary is semantic (the reader is meant to notice the line), which is exactly the exception
 * the warmth pass carves for borders that mean something.
 */
const TONE: Readonly<Record<StatePanelTone, { container: string; icon: string }>> = {
  neutral: { container: "bg-surface-elevated", icon: "text-text-muted" },
  negative: { container: "border border-negative/40 bg-surface-elevated", icon: "text-negative" },
};

export function StatePanel({ tone, icon, title, description, action, role, visual }: StatePanelProps) {
  return (
    <div role={role} className={`flex flex-col items-center gap-3 rounded-lg p-8 text-center ${TONE[tone].container}`}>
      {visual ?? <Icon name={icon} size={28} className={TONE[tone].icon} />}
      <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
      {description ? <p className="max-w-prose text-sm text-text-muted">{description}</p> : null}
      <div>{action}</div>
    </div>
  );
}
