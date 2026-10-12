/**
 * The seven bot brains. Each is nothing but a set of weight tweaks over the ONE shared sampler
 * (`chooseBotPick`, `./bots.ts`) — a position-bias map, a need scale, and for one of them a
 * run-following flag — dealt per bot per draft from the seeded stream so the same room never
 * drafts the same way twice (the founder's requirement, verbatim: "the bots should be
 * intelligent and not pick the same way every time to allow for real-world type of scenarios").
 *
 * Names are internal texture, never a member-facing claim: the room shows only the practice
 * opponent marker (`MOCK_COPY.botMarkerLabel`/`botBadge`), because a seeded sampler is not
 * intelligence and this product does not pretend otherwise.
 */
import type { Position } from "@research-ts/domain/player";
import { rngFor, seededShuffle } from "./rng";

export interface BotArchetype {
  readonly name: string;
  /** Scales how hard open starting slots pull this brain (`needMultiplier`, `./bots.ts`). */
  readonly needWeight: number;
  /** Position → weight multiplier over the base ranking. Absent means neutral (1). */
  readonly posBias: Readonly<Partial<Record<Position, number>>>;
  /** The one brain that panics with the room: a detected run gets the FULL `needBoost`. */
  readonly followsRuns?: boolean;
}

/** Weight tweaks over the shared sampler, per bot per draft — each one line of character. */
export const BOT_ARCHETYPES: readonly BotArchetype[] = [
  { name: "best_available", needWeight: 1.0, posBias: {} }, // trusts the board
  { name: "rb_heavy", needWeight: 1.0, posBias: { RB: 1.6 } }, // hammers RB early
  { name: "zero_rb", needWeight: 1.0, posBias: { RB: 0.4, WR: 1.5 } }, // fades RB, feasts WR
  { name: "qb_early", needWeight: 1.0, posBias: { QB: 1.8 } }, // takes the QB the room scoffs at
  { name: "te_premium", needWeight: 1.0, posBias: { TE: 1.7 } }, // pays up at TE
  { name: "need_filler", needWeight: 2.0, posBias: {} }, // drafts the roster sheet
  { name: "run_follower", needWeight: 1.0, posBias: {}, followsRuns: true }, // panics with the room
];

/**
 * The archetype draw's own stream key. Load-bearing for replay the same way `botRoster` ids are
 * (`MOCK_CONFIG.botRoster`'s docblock): renaming it re-deals every in-flight seeded room.
 */
const ARCHETYPE_STREAM_KEY = "archetypes";

/**
 * Deals one archetype to every bot seat from `rngFor(draftSeed, "archetypes")`: a seeded shuffle
 * of the whole deck, then round-robin. Dealt rather than drawn independently ON PURPOSE — a deal
 * guarantees the spread structurally (seven or fewer bots are always all-distinct; a wider room
 * repeats only after the deck is spent), so the same room can never field seven copies of one
 * brain no matter what the seed happens to be.
 */
export function assignArchetypes(draftSeed: number, botTeamIds: readonly string[]): Readonly<Record<string, BotArchetype>> {
  const deck = seededShuffle(BOT_ARCHETYPES, rngFor(draftSeed, ARCHETYPE_STREAM_KEY));
  return Object.fromEntries(botTeamIds.map((teamId, i) => [teamId, deck[i % deck.length]!]));
}
