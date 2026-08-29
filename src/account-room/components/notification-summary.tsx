import { Panel } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { NOTIFICATION_CATALOG, deliverableChannels, type NotificationChannel } from "@/identity";

const CHANNEL_LABEL: Readonly<Record<NotificationChannel, string>> = {
  in_app: "In the app",
  email: "Email",
};

/**
 * The catalog as a description list: what the product tells a user about, and where each one
 * reaches them today. No per-user controls here — every topic in `NOTIFICATION_CATALOG` is
 * live for everyone on `deliverableChannels()`, so there is nothing yet to individually toggle.
 *
 * The one line about email below is a statement, not a control: `@/identity/notifications`'s
 * own docblock is why there is no switch beside it. A toggle for a channel with no sender is a
 * preference this product cannot honor, and this plan's rule is that one does not ship.
 *
 * Retoned onto `Panel` (Task 18, Step 4): the account room's own "quiet label, hairline,
 * content" block, matching `StandingPanel` beside it rather than a hand-rolled `<section>` with
 * its own heading and border.
 *
 * SUNDAY v5 — THE CHANNEL COLUMN HAD ZERO VARIANCE, AND IT WAS TINTED. Every one of the five
 * topics carried the identical `Badge tone="positive"` reading "In the app", five cyan chips down
 * a column, and that is two v5 failures in one control:
 *
 * - **Law 4.** Cyan is the VERDICT channel — "we rate him higher than the room does". A delivery
 *   channel is not a verdict about anything, and spending the verdict pair on furniture is what
 *   makes the pair stop meaning anything where it is real.
 * - **The tower's own test for a column's existence** (`league-row.tsx`, the deleted Entry
 *   column): a column with zero variance carries no information. Every topic reaches everybody
 *   the same way, so the fact belongs to the PANEL, once, in the header's `meta` slot — the same
 *   move that deleted a whole column off the open-league board.
 *
 * The moment a topic can reach one member differently from another, the fact stops being panel
 * furniture and earns its column back.
 */
export function NotificationSummary() {
  const liveChannelLabel = deliverableChannels()
    .map((channel) => CHANNEL_LABEL[channel])
    .join(", ");

  return (
    <Panel title="Notifications" meta={liveChannelLabel.length === 0 ? undefined : <span className={`${MICRO_LABEL} text-text-faint`}>{liveChannelLabel}</span>}>
      <dl className="flex flex-col gap-3">
        {NOTIFICATION_CATALOG.map((topic) => (
          <div key={topic.key} className="flex flex-col gap-1 border-b border-line pb-3 last:border-b-0 last:pb-0">
            <dt className="font-medium text-text-primary">{topic.title}</dt>
            <dd className="text-sm text-text-muted">{topic.detail}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-text-muted">Email updates are not connected yet. When they are, you will choose which of these arrive in your inbox.</p>
    </Panel>
  );
}
