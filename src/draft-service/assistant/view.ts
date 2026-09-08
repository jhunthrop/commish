/**
 * THE ADVISOR'S WIRE SHAPE — what `GET /api/drafts/[draftId]/assistant` returns and what the
 * room's one card, the pool rows and the Draft HQ demo render. Types only, no imports of server
 * values, so a client component may `import type` from here across the room/server boundary.
 *
 * Every number here names its basis: a survival fraction carries the run count it is over, the
 * pool-wide odds carry the pick they are measured at and the runs that reached it. Absence is
 * `null`, never a stand-in. Names, teams, byes and headshots are the room's own (`playersById`),
 * so the wire carries ids only.
 */
import type { Position } from "@/domain/player";
import type { RosterSlotType } from "@/domain/roster";

/** A survival fraction and the runs it is a fraction of. */
export interface OddsCell {
  readonly survival: number;
  readonly runs: number;
}

/** The one pick the card argues for. */
export interface NextPick {
  readonly playerId: string;
  readonly position: Position;
  /** 1-based rank within his position on our board. */
  readonly positionRank: number;
  readonly valueOverReplacement: number;
  /** The roster slot he would fill, or `null` when the roster cannot take him. */
  readonly fillsSlot: RosterSlotType | null;
  /** Odds he is still there at your next turn; `null` when no next turn exists. */
  readonly makeItBack: OddsCell | null;
  /** At most two sentences, built from the room's own signals. */
  readonly why: string;
  /** The sentence shape dealt this turn (`cliff:1`), so a test can check rotation, not words. */
  readonly whyShape: string;
}

/** Next-turn survival for every undrafted player, as runs over runs. */
export interface SurvivalOdds {
  /** Your next pick number, the turn the odds are measured at. */
  readonly pickNumber: number;
  /** Runs that reached that turn, the denominator for every entry. */
  readonly runs: number;
  /** Player id -> runs in which he was still on the board at that turn. */
  readonly survived: Readonly<Record<string, number>>;
}

/** Where an undrafted player sits in his position's games-worth tiers on our board. */
export interface TierStandingView {
  /** 1-based tier within the position. */
  readonly tier: number;
  /** Undrafted players left in the tier, him included. */
  readonly left: number;
  /** The tier's size on the full board. */
  readonly size: number;
}

export interface AdvisorStamp {
  readonly computedAtPick: number;
  readonly sequence: number;
}

export interface AdvisorView {
  /** The pick the card decides: your current pick on the clock, your next one otherwise. */
  readonly pickNumber: number;
  readonly onTheClock: boolean;
  /** Picks before yours: 0 on the clock. */
  readonly picksUntilYourTurn: number;
  readonly teamCount: number;
  readonly stamp: AdvisorStamp;
  /** Continuations behind every odds number on this view. */
  readonly runs: number;
  /** `null` when nothing on the board fits your roster. */
  readonly pick: NextPick | null;
  /** `null` when you have no next turn: the draft ends first. */
  readonly odds: SurvivalOdds | null;
  /** Undrafted players at positions our board projects; a market-order position has no entry. */
  readonly tiers: Readonly<Record<string, TierStandingView>>;
}
