import type { DraftFormat } from "./league";

export type DraftStatus = "scheduled" | "in_progress" | "complete";

export interface Draft {
  readonly id: string;
  readonly leagueId: string;
  readonly format: DraftFormat;
  readonly status: DraftStatus;
  readonly kickoffAt: string;
  readonly auctionBudget: number | null;
}

export type DraftActionType = "MAKE_PICK" | "NOMINATE" | "BID" | "TIMER_EXPIRE";

export interface DraftAction {
  readonly draftId: string;
  readonly type: DraftActionType;
  readonly teamId: string;
  readonly playerId: string | null;
  readonly bidAmount: number | null;
  readonly timestamp: string;
}

export interface DraftPick {
  readonly draftId: string;
  readonly teamId: string;
  readonly playerId: string;
  readonly round: number;
  readonly pickNumber: number;
  readonly price: number | null;
}
