import type { RealtimeEventType } from "@/lib/realtime/events";

/**
 * Where a notification can land. `in_app` is real today — the toast/banner surfaces already
 * wired to the realtime stream. `email` is modeled and named so the catalog can describe what
 * it will one day carry, but Plan D owns the sender: see `channelStatus`.
 */
export type NotificationChannel = "in_app" | "email";

/**
 * One row of the catalog the profile page shows: a topic a user might want to hear about, in
 * plain language, and the real event types that make it fire. `events` is typed as
 * `readonly RealtimeEventType[]` — imported as a TYPE ONLY — so a topic can only ever name an
 * event the taxonomy actually declares; `notifications.test.ts` checks the stronger claim that
 * every named event is one the product actually publishes today (`REALTIME_EVENT_TYPES`).
 */
export interface NotificationTopic {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly events: readonly RealtimeEventType[];
}

/**
 * What this product tells a user about, described honestly rather than exhaustively: every
 * entry maps to real events, checked by `notifications.test.ts` against the one event taxonomy
 * (`@/lib/realtime/events`), so a topic can never promise a notification nobody sends.
 */
export const NOTIFICATION_CATALOG: readonly NotificationTopic[] = [
  { key: "draft-turn", title: "It's your turn to pick", detail: "While you're in the draft room.", events: ["draft.pick", "draft.nudge"] },
  { key: "draft-start", title: "Your draft is starting", detail: "While you're in the league.", events: ["draft.status"] },
  { key: "scores", title: "Your scores are moving", detail: "On your league page and your home page, while games are being played.", events: ["score.update"] },
  { key: "chat", title: "Your league is talking", detail: "In the league's chat.", events: ["chat.message", "chat.reaction"] },
  {
    key: "platform-actions",
    title: "When the platform acts on your league",
    detail: "In the app, in your notices and on your league's activity page.",
    events: ["notice.created"],
  },
];

/**
 * Single source of truth for what each channel can do today. `in_app` is live because the
 * realtime stream already delivers it; `email` is not-connected because Plan D has not yet
 * built the sender. Nothing reads or writes an email preference anywhere in this product — a
 * stored preference for a channel with no sender is a switch wired to nothing, which the
 * no-MVP directive rules out. The day the sender exists, this map (and only this map) changes.
 */
const CHANNEL_STATUS: Readonly<Record<NotificationChannel, "live" | "not-connected">> = {
  in_app: "live",
  email: "not-connected",
};

export function channelStatus(channel: NotificationChannel): "live" | "not-connected" {
  return CHANNEL_STATUS[channel];
}

/** The channels a user can actually be reached on right now. Never offered as a toggle if it isn't in this list. */
export function deliverableChannels(): readonly NotificationChannel[] {
  return (Object.keys(CHANNEL_STATUS) as readonly NotificationChannel[]).filter((channel) => channelStatus(channel) === "live");
}
