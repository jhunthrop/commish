import type { Player } from "@/domain/player";
import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";

/**
 * The two response bodies the draft room reads. Declared once, imported by the route
 * handlers as their return shape and by the client hook as its parse target, so the two
 * sides of the wire cannot drift. Types only — this module emits no runtime code.
 */
export interface DraftSnapshotBody {
  readonly draft: DraftStateView;
  /** The league's display name — what `RoomHeader` puts at the top of the board. */
  readonly leagueName: string;
  /** The caller's own team, or null for a commissioner without one. */
  readonly teamId: string | null;
  readonly isCommissioner: boolean;
  readonly teams: readonly TeamCard[];
  /** The caller's OWN autopick queue. Never anybody else's — a queue is a private draft plan. */
  readonly queue: readonly string[];
}

export interface DraftPlayersBody {
  readonly players: readonly Player[];
}

export interface DraftQueueBody {
  readonly queue: readonly string[];
}
