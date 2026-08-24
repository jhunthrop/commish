import { Badge, Panel } from "@/components/ui";
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
 * Retoned onto `Panel` (Task 18, Step 4): the account room's own "uppercase label, hairline,
 * content" block, matching `StandingPanel` beside it rather than a hand-rolled `<section>` with
 * its own heading and border. The heading text and the description list underneath it are
 * unchanged — only the wrapper is.
 */
export function NotificationSummary() {
  const liveChannelLabel = deliverableChannels()
    .map((channel) => CHANNEL_LABEL[channel])
    .join(", ");

  return (
    <Panel title="Notifications">
      <dl className="flex flex-col gap-3">
        {NOTIFICATION_CATALOG.map((topic) => (
          // `<dl>`'s allowed direct children are `<dt>`/`<dd>` pairs, optionally grouped in a
          // `<div>` — the badge lives INSIDE `<dt>` rather than beside it in its own wrapper,
          // so this stays a valid (and axe-clean) description list.
          <div key={topic.key} className="flex flex-col gap-1 border-b border-line pb-3 last:border-b-0 last:pb-0">
            <dt className="flex flex-wrap items-center justify-between gap-2 font-medium text-text-primary">
              <span>{topic.title}</span>
              {liveChannelLabel.length > 0 && <Badge tone="positive">{liveChannelLabel}</Badge>}
            </dt>
            <dd className="text-sm text-text-muted">{topic.detail}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-text-muted">Email updates are not connected yet. When they are, you will choose which of these arrive in your inbox.</p>
    </Panel>
  );
}
