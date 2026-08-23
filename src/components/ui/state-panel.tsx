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
}

const TONE: Readonly<Record<StatePanelTone, { container: string; icon: string }>> = {
  neutral: { container: "border-dashed border-line", icon: "text-text-muted" },
  negative: { container: "border-negative/40 bg-surface-elevated", icon: "text-negative" },
};

export function StatePanel({ tone, icon, title, description, action, role }: StatePanelProps) {
  return (
    <div role={role} className={`flex flex-col items-center gap-3 rounded-lg border p-8 text-center ${TONE[tone].container}`}>
      <Icon name={icon} size={28} className={TONE[tone].icon} />
      <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
      {description ? <p className="max-w-prose text-sm text-text-muted">{description}</p> : null}
      <div>{action}</div>
    </div>
  );
}
