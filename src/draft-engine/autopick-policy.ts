import type { RosterCeilingPolicy } from "./roster-need";

/**
 * The need-aware autopick scoring dials (the 2026-09-03 upgrade). Like `DraftSkipPolicy`
 * above, this is read by a REDUCER path — `bestAvailableFor` folds every TIMER_EXPIRE's
 * autopick — so it must be a value frozen into each draft's own history rather than one
 * re-read fresh on every load: `applyAction` snapshots `AUTOPICK_CONFIG` below onto the
 * `START_DRAFT` action (`StartDraftAction.autopick`, `@/domain/draft`), `reduceStart` copies
 * it into `DraftConfig.autopick`, and the selector reads ONLY that snapshot. A deploy that
 * retunes these numbers changes future drafts and never what an already-persisted
 * TIMER_EXPIRE did. A config with NO snapshot (a log from before the upgrade) replays under
 * the pre-upgrade policy: plain board-order fallback, need weight permanently zero.
 */
export interface DraftAutopickPolicy {
  /** Exponential decay steepness of `rankWeight`: one board rank costs ×exp(-1/3) ≈ 0.72. */
  readonly temperature: number;
  /** Additive warmth per open dedicated starting slot, at full ramp. */
  readonly needPerOpenStartingSlot: number;
  /** The cooled multiplier for a position whose dedicated starters are all filled, at full ramp. */
  readonly startersFilledDamp: number;
  /** Fraction of the roster a team must have filled for the need ramp to reach full weight. */
  readonly rampFullAtRosterFraction: number;
  /**
   * The 2026-09-05 fix for the QB-stacking incident (prod mock draft
   * 25642877-0841-49a5-8511-f3655d8064b1, replayed in full): `needMultiplier` was saturation-
   * blind — once a position's dedicated starters were filled, EVERY further body there cooled
   * to the same flat `startersFilledDamp` forever, so a team's second and third QB in a 1-QB
   * room scored no worse than its first starter going one over. With every skill position
   * equally "filled" by round 7, board order alone decided, and autopick stacked QB2 (Purdy,
   * pick 95) and QB3 (Dart, pick 98) as the top of the remaining board.
   *
   * `startersFilledDamp` now compounds by this value once per extra body already rostered at a
   * filled position (`scoring.ts`'s `NeedMultiplierOptions.surplusDamp`, ramped the same way
   * `startersFilledDamp` itself is — see `bestAvailableFor`, `selectors.ts`): a second body
   * merely unattractive, a third effectively never. OPTIONAL, and absent means NO compounding at
   * all — the flat pre-fix `startersFilledDamp`, byte for byte — for the identical F3 reason
   * `startersFilledDamp` itself must never retroactively change what an already-persisted
   * autopick did: a log from before this fix carries no `surplusDamp` and must keep replaying
   * without it.
   */
  readonly surplusDamp?: number;
  /**
   * HOW MANY ROUNDS FROM THE END a kicker or a team defence becomes takeable
   * (`LATE_ROUND_ONLY_POSITIONS`, `roster-need.ts`), unless every OTHER dedicated starting slot on the
   * team is already filled.
   *
   * THE PROBLEM IT SOLVES. `needMultiplier` is position-blind about WHEN: an open starting slot is
   * an open starting slot, so a kicker's `1 + needPerOpenStartingSlot` reads exactly like a second
   * receiver's. Nothing in the scoring knows that a kicker is the pick every real manager makes
   * last, and a room that autopicked one in round five for an absent manager would be visibly wrong
   * to every other seat.
   *
   * AND IT NEVER STRANDS A SEAT WITHOUT ONE. Deferring is a preference and not a ban, in three
   * ways. It lifts once the team is inside the final `lateRoundOnlyRoundsFromEnd` rounds, measured
   * against the team's OWN roster length rather than the global pick number, so a team redeeming
   * owed picks is judged on its own progress exactly the way `needRamp` judges it. It lifts
   * immediately, at any point in the draft, once every other dedicated starting slot is filled. And
   * `bestAvailableFor` keeps the best deferred candidate as a fallback, so a board that is nothing
   * BUT kickers and defences still returns a pick rather than null. A league whose roster starts
   * neither is unaffected: the deferral reads the slot config and finds nothing to defer for.
   *
   * OPTIONAL, AND ABSENT MEANS NO DEFERRAL AT ALL — the pre-policy behaviour, byte for byte, for
   * the identical F3 reason `surplusDamp` and `skipPolicy` carry: this value rides the
   * `START_DRAFT` snapshot (`StartDraftAction.autopick`), and a log written before this policy
   * existed must keep replaying without it forever.
   */
  readonly lateRoundOnlyRoundsFromEnd?: number;
  /**
   * THE ROSTER-NEED CEILINGS (the 2026-09-12 round, founder report: autopick took three
   * quarterbacks in real mock drafts; measured at two on 99% of autopicked teams and three on
   * 12%, 47% in the founder's own bot rooms, before this field). When present, `bestAvailableFor`
   * scores under `roster-need.ts`'s rule instead of `needMultiplier`'s: a candidate who would
   * start is warm per open starting slot he could fill, the flex included; a candidate who would
   * sit is cooled to `startersFilledDamp` and again by `surplusDamp` per body already sitting at
   * his position (bench bodies, never a flex starter, which is the count the older scoring got
   * wrong); a position is capped at its starters plus its bench allowance (`positionCeiling`);
   * and a backup at a position no flex takes waits until every starter is filled.
   *
   * OPTIONAL, AND ABSENT MEANS THE SURPLUS-DAMP SCORING, BYTE FOR BYTE, for the identical F3
   * reason every other field here carries: this value rides the `START_DRAFT` snapshot, and a
   * log written before the ceilings existed must keep replaying without them forever.
   */
  readonly rosterCeilings?: RosterCeilingPolicy;
}

/**
 * The clock-expiry autopick's own scoring dials (spec:
 * `docs/superpowers/specs/2026-09-03-autopick-design.md`). When a real manager's clock runs
 * out and their queue is empty or exhausted, `bestAvailableFor` (`selectors.ts`) takes a
 * deterministic argmax over every legal available player, scored
 * `rankWeight(legalIndex, temperature) × needMultiplier(position)` — the identical
 * rank-and-need SHAPE the practice bots sample from (`scoring.ts`, shared), with no RNG
 * anywhere: the same action log always replays to the same autopick. That determinism claim
 * is scoped to a single JavaScript engine build — `Math.exp` is specified as a
 * good-faith approximation, not bit-exact across engines — which is one more reason the
 * values ride the action log (`DraftAutopickPolicy` above) instead of being read live.
 *
 * These values deliberately MATCH `MOCK_CONFIG.strategy`'s (the tuning the founder already
 * approved for the bots) but are the engine's OWN constants: `src/mock-draft` sits above this
 * engine and is never imported here, and retuning a practice bot must never retune a money
 * room's autopick.
 *
 * The need term is RAMPED by the team's own draft progress (`roster.length`, never the global
 * pick number, so owed catch-up picks score sanely): zero on a team's first pick (the argmax
 * provably degenerates to plain board order), scaling LINEARLY to full weight once the roster
 * is `rampFullAtRosterFraction` full. Linear on purpose — the exponential rankWeight already
 * dominates early, and a money-room dispute must be re-derivable by hand. The worst "reach"
 * this scoring can ever make is `temperature × ln(maxBoost / minDamp)` ranks (≈3.3 at these
 * values), bounded by construction rather than by a depth cap.
 */
/**
 * `surplusDamp: 0.25` — the incident's own arithmetic (`DraftAutopickPolicy.surplusDamp`'s
 * docblock above), at full ramp: a first surplus body (dedicated slots exactly at capacity, the
 * candidate the one over) scores `startersFilledDamp × 0.25^1 = 0.15` instead of the flat `0.6`
 * every other filled position still gets; a second surplus body scores `0.6 × 0.25^2 = 0.0375`.
 * Steep on purpose — a bench QB behind a 1-QB starter is close to dead weight, not merely a
 * worse RB3.
 */
/**
 * `lateRoundOnlyRoundsFromEnd: 2` — the last two rounds, which under `STANDARD_ROSTER_SLOTS` (15
 * slots) means a kicker and a team defence become takeable at a team's 14th and 15th picks. TWO and
 * not one because both positions have to fit, and a one-round window would force a seat to take one
 * of them out of order on its very last pick. See `DraftAutopickPolicy.lateRoundOnlyRoundsFromEnd`
 * for the whole argument and for the three ways the deferral lifts.
 */
/**
 * `rosterCeilings: { backupsAtSingleStarterPosition: 1 }` — one bench body at a position the
 * league starts one of (the quarterback, the tight end), the founder's ruling of 2026-09-12: "a
 * team holds at most two of any of them regardless of shape". The backs' and receivers'
 * allowances are not dials: `positionCeiling` derives them from what the bench has left, by
 * starting demand with the flex included (four over RB 3 and WR 3 in the standard shape, two
 * each), so a league with a longer bench widens them on its own.
 */
export const AUTOPICK_CONFIG: DraftAutopickPolicy = {
  temperature: 3.0,
  needPerOpenStartingSlot: 0.4,
  startersFilledDamp: 0.6,
  rampFullAtRosterFraction: 0.5,
  surplusDamp: 0.25,
  lateRoundOnlyRoundsFromEnd: 2,
  rosterCeilings: { backupsAtSingleStarterPosition: 1 },
};
