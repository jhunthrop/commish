import { z } from "zod";
import type { DraftClockView } from "@/draft-engine";

/**
 * The SSE boundary. Everything arriving on the stream is untrusted text until it has been
 * through these schemas — the same "validate at every boundary" rule the API routes follow,
 * applied in the other direction.
 */
const clockSchema = z.object({
  phase: z.enum(["scheduled", "in_progress", "complete"]),
  sequence: z.number().int().nonnegative(),
  pickNumber: z.number().int().nonnegative(),
  onClockTeamId: z.string().nullable(),
  deadlineAt: z.string().nullable(),
  clockSeconds: z.number().nullable(),
  nextTightening: z.object({ at: z.string(), pickSeconds: z.number() }).nullable(),
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
  slot: z.enum(["QB", "RB", "WR", "TE", "FLEX", "K", "DEF", "BENCH"]),
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
const expirePayloadSchema = z.object({ ...common, pickNumber: z.number().int().nonnegative() });

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
]);

export type DraftEventFrame = z.infer<typeof draftEventSchema>;
export type DraftPickPayload = z.infer<typeof pickPayloadSchema>;
export type DraftNominatePayload = z.infer<typeof nominatePayloadSchema>;
export type DraftBidPayload = z.infer<typeof bidPayloadSchema>;
