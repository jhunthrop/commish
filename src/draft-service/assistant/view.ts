/**
 * THE ADVISOR'S WIRE SHAPE — what `GET /api/drafts/[draftId]/assistant` returns and what the
 * room's advisor tab and the Draft HQ demo both render. Types only, no imports of server values,
 * so a client component may `import type` from here across the room/server boundary.
 *
 * Every number here names its basis: a survival fraction carries the run count it is over
 * (`OddsCell.runs`), a tendency carries the runs it was tallied from, a tier collapse carries the
 * board's own drop. Absence is `null`, never a stand-in.
 */
import type { Position } from "@/domain/player";
import type { RosterSlotType } from "@/domain/roster";
import type { PickReason } from "@/projections/decide/draft";
import type { BuildLabel } from "../sim/classify";
import type { BuildOutcome } from "../sim/types";

/** A survival fraction and the runs it is a fraction of. */
export interface OddsCell {
  readonly survival: number;
  readonly runs: number;
}

export interface PlanTarget {
  readonly playerId: string;
  readonly position: Position;
  readonly valueOverReplacement: number;
  readonly positionRank: number;
  /** Index 0 is your next turn. `null` where that turn does not exist or no run reached it. */
  readonly oddsByTurn: readonly (OddsCell | null)[];
  /** The first turn (1-based) at which he sits under the reach floor; `null` if never. */
  readonly reachFromTurn: number | null;
}

export interface PlanTurn {
  readonly turn: number;
  readonly pickNumber: number;
  readonly round: number;
  readonly position: Position;
  readonly targets: readonly PlanTarget[];
  readonly fallback: PlanTarget | null;
}

export interface DraftPlan {
  readonly computedAtPick: number;
  readonly runs: number;
  readonly horizon: number;
  readonly reachFloor: number;
  /** Shorter than `horizon` when the draft ends first: a turn beyond the end does not exist. */
  readonly turns: readonly PlanTurn[];
}

export type SeatDriverView =
  | { readonly kind: "archetype"; readonly name: string; readonly basis: "inferred" | "prior"; readonly picksObserved: number }
  | { readonly kind: "autopick"; readonly picksObserved: number };

export interface SeatAhead {
  readonly teamId: string;
  /** 1-based seat in the draft order, for a label that needs no team name. */
  readonly seat: number;
  readonly pickNumber: number;
  readonly runs: number;
  readonly topPosition: { readonly position: Position; readonly share: number } | null;
  readonly topPlayer: { readonly playerId: string; readonly share: number } | null;
  readonly driver: SeatDriverView;
}

export interface PositionRun {
  readonly position: Position;
  readonly count: number;
  readonly window: number;
}

export interface TierCollapse {
  readonly position: Position;
  /** "A", "B", ... from the board's own tier index at this position. */
  readonly tierLabel: string;
  readonly playersLeftInTier: number;
  readonly dropToNextTier: number;
}

export interface RoomSignals {
  readonly run: PositionRun | null;
  readonly collapses: readonly TierCollapse[];
  readonly ahead: readonly SeatAhead[];
}

export interface NowCandidate {
  readonly playerId: string;
  readonly position: Position;
  readonly valueOverReplacement: number;
  readonly positionRank: number;
  readonly makeItBack: OddsCell | null;
  /** The roster slot he would fill, or `null` when the roster cannot take him. */
  readonly fillsSlot: RosterSlotType | null;
  readonly reasons: readonly PickReason[];
  /** The deterministic sentence, always present. The writer's sentence replaces it on screen. */
  readonly templateReason: string;
}

export type VoiceStatus = "ready" | "pending" | "absent";

export interface AdvisorVoice {
  readonly status: VoiceStatus;
  readonly strategy: string | null;
  /** Player id -> the written reason, only for the ones the validator accepted. */
  readonly reasons: Readonly<Record<string, string>>;
}

export interface AdvisorStamp {
  readonly computedAtPick: number;
  readonly sequence: number;
}

/** The turn's own fact ledger: what a written sentence may cite. */
export interface TurnLedger {
  readonly numbers: readonly number[];
  readonly names: readonly string[];
}

export interface AdvisorView {
  readonly pickNumber: number;
  readonly onTheClock: boolean;
  /** Picks before yours: 0 on the clock. */
  readonly picksUntilYourTurn: number;
  readonly teamCount: number;
  readonly stamp: AdvisorStamp;
  readonly now: readonly NowCandidate[];
  readonly plan: DraftPlan;
  readonly signals: RoomSignals;
  readonly yourBuild: readonly BuildLabel[];
  readonly winningBuilds: readonly BuildOutcome[] | null;
  readonly computedBasis: string;
  /** Display names for every player id on this view. */
  readonly names: Readonly<Record<string, string>>;
  readonly strategyTemplate: string;
  readonly voice: AdvisorVoice;
  readonly ledger: TurnLedger;
}
