import type { ReactNode } from "react";
import { EYEBROW } from "@/components/ui";

/**
 * One row: a plain-language heading and body a caller writes, plus whatever real control answers
 * it (`content`) — never a link that only describes what the click would do
 * (`first-run-panel.tsx`'s own rule, restated here for the same reason). `content` is optional
 * only for a row that is a stated fact rather than an action (Task 9, Step 4's "name your team"
 * and "turn on notices" rows, neither of which this product has a control for yet — see the
 * component's own docblock).
 */
export interface WaitingChecklistItem {
  readonly key: string;
  readonly heading: string;
  readonly body: string;
  readonly content?: ReactNode;
}

/**
 * The waiting room's four-item checklist (Phase 3.6, Task 9, Step 4), resequenced and made real.
 * Purely presentational and ORDER-BLIND: it renders `items` in the order it is handed them, never
 * deciding for itself which manager sees the room tour first — `WaitingRoom` (the room, not this
 * component) is the one place that knows whether the caller has ever drafted before, and Task 10's
 * pre-draft home inlines this exact component for its own hero, so the ordering has to live
 * upstream of both callers rather than duplicated in each (F18's own pointer).
 *
 * `<ol>`, not `<ul>`: the four items are a sequence a manager works through, not an unordered set,
 * and the gauntlet's own finding was about visual weight, not list semantics — an `<ol>` costs
 * nothing extra and states the "do these in order" intent a screen reader can announce.
 */
export function WaitingChecklist({ items }: { readonly items: readonly WaitingChecklistItem[] }) {
  return (
    <ol aria-label="Get ready" className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.key} className="flex flex-col gap-2 rounded-lg bg-surface-elevated p-3">
          <div className="flex flex-col gap-1">
            <h3 className={EYEBROW}>{item.heading}</h3>
            <p className="text-sm text-text-muted">{item.body}</p>
          </div>
          {item.content === undefined ? null : item.content}
        </li>
      ))}
    </ol>
  );
}
