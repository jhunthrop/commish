import type { DraftStatus } from "@/domain/draft";
import type { DraftFormat } from "@/domain/league";

/**
 * TYPES ONLY, no runtime code. Imported by the `/api/leagues/**` routes as their return shape
 * and by the client components as their prop shape, so the two cannot drift.
 */
export interface LeagueSummary {
  readonly id: string;
  readonly name: string;
  readonly format: DraftFormat;
  readonly teamCount: number;
  readonly filledTeams: number;
  readonly isCommissioner: boolean;
  readonly myTeamId: string | null;
  readonly draftId: string | null;
  readonly draftStatus: DraftStatus | null;
}

export interface LeagueListBody {
  readonly leagues: readonly LeagueSummary[];
}

export interface CreateLeagueBody {
  readonly leagueId: string;
  readonly teamId: string;
  readonly draftId: string;
}

export interface InviteBody {
  readonly code: string;
  /** An absolute PATH, not a full URL — the browser already knows its own origin. */
  readonly path: string;
  readonly expiresAt: string;
  readonly maxUses: number;
}

export interface JoinBody {
  readonly leagueId: string;
  readonly teamId: string;
  readonly alreadyMember: boolean;
}
