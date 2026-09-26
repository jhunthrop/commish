import { z } from "zod";
import type { DraftClockView } from "@/draft-engine";

/**
 * The SSE boundary. Everything arriving on the stream is untrusted text until it has been
 * through these schemas — the same "validate at every boundary" rule the API routes follow,
 * applied in the other direction.
 */
const clockSchema = z.object({
  // `"dissolved"` (Phase 4, Task 9, `@/domain/draft`'s own `DraftStatus`) joins this enum for the
  // bidirectional check below alone, never because the wire actually sends it: a dissolved
  // league's draft never reaches `"scheduled"`'s live session at all (dissolution is pre-draft
  // only), so this stream never opens for one and `phase` never carries the value in practice.
  phase: z.enum(["scheduled", "in_progress", "complete", "dissolved"]),
  sequence: z.number().int().nonnegative(),
  pickNumber: z.number().int().nonnegative(),
  onClockTeamId: z.string().nullable(),
  deadlineAt: z.string().nullable(),
  clockSeconds: z.number().nullable(),
  nextTightening: z.object({ at: z.string(), pickSeconds: z.number() }).nullable(),
  // `.readonly()` is load-bearing, not decoration: `DraftClockView.upcoming` is a
  // `readonly string[]`, and a mutable `string[]` is not assignable to it in BOTH directions,
  // so a plain `z.array` would fail the bidirectional shape assertion below.
  upcoming: z.array(z.string()).readonly(),
  // Task 4's overnight freeze. `.optional()` matches `DraftClockView.pausedUntil` being an
  // optional field (the engine's own test suite predates this task and hand-builds plenty of
  // `DraftClockView` literals that never set it) — the server always sends it in a real payload,
  // but the schema itself only needs to say what's ALLOWED, and stripping it silently (the
  // default for a key `z.object` doesn't know about) would have been the actual bug here: the
  // room would never see a paused turn at all.
  pausedUntil: z.string().nullable().optional(),
  // Task 5's owed picks: teamId -> the pick numbers they still owe. `.optional()` matches
  // `DraftClockView.owedPicks` being optional for the identical reason `pausedUntil` is — the
  // engine's own test suite predates this task and hand-builds `DraftClockView` literals that
  // never set it. The server always sends it in a real payload.
  owedPicks: z.record(z.string(), z.array(z.number()).readonly()).optional(),
});

/**
 * A zero-cost bidirectional check that `clockSchema` still matches `DraftClockView` field for
 * field. If the engine ever adds, removes or retypes a clock field without a matching change
 * here, one of these two `extends` checks resolves to `never` and the assignment below stops
 * typechecking — a compile error instead of a silent drift between the wire schema and the
 * view the rest of the room trusts. `void`-read so it also can't trip an unused-var lint rule.
 */
type ClockSchemaShape = z.infer<typeof clockSchema>;
type ClockShapesMatch = ClockSchemaShape extends DraftClockView ? (DraftClockView extends ClockSchemaShape ? true : never) : never;
const _clockSchemaMatchesDraftClockView: ClockShapesMatch = true;
void _clockSchemaMatchesDraftClockView;

const common = { draftId: z.string().min(1), clock: clockSchema };
const dollarsByTeam = z.record(z.string(), z.number());

const pickPayloadSchema = z.object({
  ...common,
  pickNumber: z.number().int().positive(),
  round: z.number().int().positive(),
  teamId: z.string().min(1),
  playerId: z.string().min(1),
  // Every `RosterSlotType` (`@/domain/roster`), the superflex included: a pick into a slot this
  // list lacked failed the parse and cost the room a resync it never needed.
  slot: z.enum(["QB", "RB", "WR", "TE", "FLEX", "SUPERFLEX", "K", "DEF", "BENCH"]),
  slotIndex: z.number().int().nonnegative(),
  price: z.number().nullable(),
  timestamp: z.string().min(1),
  auto: z.boolean(),
  /** Auction awards only — the post-award money, computed by the engine. */
  budgets: dollarsByTeam.optional(),
  maxBids: dollarsByTeam.optional(),
  /** Auction awards only — the floor for the NEXT bid, after this pick closed the lot. */
  minBid: z.number().optional(),
});

const nominatePayloadSchema = z.object({
  ...common,
  teamId: z.string().min(1),
  playerId: z.string().min(1),
  openingBid: z.number(),
  auto: z.boolean(),
  /** The floor for the NEXT bid on this lot — the engine's number, never `highBid + increment`. */
  minBid: z.number(),
});
const bidPayloadSchema = z.object({
  ...common,
  teamId: z.string().min(1),
  playerId: z.string().min(1),
  amount: z.number(),
  /** The floor for the NEXT bid on this lot — the engine's number, never `highBid + increment`. */
  minBid: z.number(),
});
const statusPayloadSchema = z.object({ ...common, phase: z.enum(["scheduled", "in_progress", "complete"]) });
/** `skipped` is Task 5's own addition: true when this expiry owed the pick instead of making it. */
const expirePayloadSchema = z.object({ ...common, pickNumber: z.number().int().nonnegative(), skipped: z.boolean() });
const queuePayloadSchema = z.object({ ...common, teamId: z.string().min(1) });

/** The moderator's prompt. The queue itself is never on the wire — only this sentence. */
const nudgePayloadSchema = z.object({ ...common, teamId: z.string().min(1), message: z.string().min(1) });

/**
 * A `draft.*` frame off the league stream. Non-draft event types (`chat.*`, `score.update`)
 * simply fail this union and are ignored — the draft room is not their consumer.
 */
export const draftEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("draft.pick"), payload: pickPayloadSchema }),
  z.object({ type: z.literal("draft.nominate"), payload: nominatePayloadSchema }),
  z.object({ type: z.literal("draft.bid"), payload: bidPayloadSchema }),
  z.object({ type: z.literal("draft.status"), payload: statusPayloadSchema }),
  z.object({ type: z.literal("draft.timer_expire"), payload: expirePayloadSchema }),
  z.object({ type: z.literal("draft.queue"), payload: queuePayloadSchema }),
  z.object({ type: z.literal("draft.nudge"), payload: nudgePayloadSchema }),
]);

export type DraftEventFrame = z.infer<typeof draftEventSchema>;

/** THE FACTS FRAME (`draft.facts`, `@/lib/realtime/events`): the advisor's facts for a sequence
 *  are written (`ready`), or their compute failed and a viewer should ask anyway. */
export const factsFrameSchema = z.object({ type: z.literal("draft.facts"), payload: z.object({ draftId: z.string().min(1), sequence: z.number().int().nonnegative(), ready: z.boolean() }) });

export type FactsFrame = z.infer<typeof factsFrameSchema>;

/** One `draft.facts` frame off the stream, parsed and validated; `null` for anything else. */
export function parseFactsFrame(data: string): FactsFrame | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = factsFrameSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
export type DraftPickPayload = z.infer<typeof pickPayloadSchema>;
