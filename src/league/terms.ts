import type { DraftFormat } from "@/domain/league";
import { BENCH_SLOT, type RosterSlotConfig } from "@/domain/roster";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { stakeTierLabel } from "@/matchmaking/filter";
import { describeScoring, type ScoringRules } from "@/scoring";

/**
 * Everything a person decides whether to join with, in one pure value. Rendered by
 * `LeagueTermsPanel` (`@/league-room/components/league-terms-panel`) on the invite preview
 * page AND inside the league itself (Task 8) — the SAME shape, computed by this SAME function,
 * so a prospect reading the invite and a member reading the league home can never be told two
 * different things about the league they are both looking at.
 */
export interface LeagueTerms {
  readonly name: string;
  readonly format: DraftFormat;
  readonly teamCount: number;
  readonly filledTeams: number;
  /** Derived from the league's scoring weights (`describeScoring`) — never the raw weights. */
  readonly scoringLabel: string;
  /** A roster shape a human can read — e.g. "1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DEF, 6 bench". */
  readonly rosterLine: string;
  readonly stakeLabel: string;
  /**
   * The exact sentence `MATCHMAKING_CONFIG.stakeDisclosure` carries, never retyped here. Phase 1
   * wrote it once for `/browse`; this is the other place somebody decides to enter a league, and
   * two hand-written versions of "no money changes hands" is exactly how one goes stale the week
   * money starts changing hands.
   */
  readonly stakeDisclosure: string;
  readonly commissionerName: string;
  /** The commissioner's STORED avatar ref, not a URL — same contract as `Avatar`'s `avatar` prop. */
  readonly commissionerAvatar: string | null;
}

export interface LeagueTermsInput {
  readonly name: string;
  readonly format: DraftFormat;
  readonly teamCount: number;
  readonly filledTeams: number;
  readonly scoring: ScoringRules;
  readonly rosterSlots: readonly RosterSlotConfig[];
  /** Cosmetic tier index only — see `MATCHMAKING_CONFIG.stakeTiers`. Never an amount of money. */
  readonly stakeTier: number;
  readonly commissioner: { readonly displayName: string; readonly avatarUrl: string | null };
}

/**
 * "1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DEF, 6 bench" — every slot's count and name, in the
 * league's own configured order, with the one rename this product's slot type needs: the raw
 * slot value is already the right word for every position slot (`QB`, `RB`, `FLEX`, ...), and
 * `BENCH_SLOT` is the one value that reads better lower-cased than shouted.
 */
function rosterLine(slots: readonly RosterSlotConfig[]): string {
  return slots.map((slot) => `${slot.count} ${slot.slot === BENCH_SLOT ? "bench" : slot.slot}`).join(", ");
}

/**
 * Pure. Turns raw league facts into the terms a human reads before joining — the one place
 * that assembly happens, so the invite preview and the in-league panel can only ever agree.
 */
export function leagueTerms(input: LeagueTermsInput): LeagueTerms {
  return {
    name: input.name,
    format: input.format,
    teamCount: input.teamCount,
    filledTeams: input.filledTeams,
    scoringLabel: describeScoring(input.scoring),
    rosterLine: rosterLine(input.rosterSlots),
    stakeLabel: stakeTierLabel(input.stakeTier),
    stakeDisclosure: MATCHMAKING_CONFIG.stakeDisclosure,
    commissionerName: input.commissioner.displayName,
    commissionerAvatar: input.commissioner.avatarUrl,
  };
}
