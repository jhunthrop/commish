import type { ReactNode } from "react";
import type { Player } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import { EYEBROW, PositionBadge, SlotChip } from "@/components/ui";
import { playerName, playersById as buildPlayersById } from "../lib/lookups";
import { formatBoardDelta, rankByPlayerId } from "../state/format";
import { SLOT_POSITION } from "./room-dock";

/** Mirrors `MockResultsCopy` (`../contract`) — the wire type this room fetches, forwarded down
 *  as one prop rather than five so `DraftRoom` stays a single pass-through. */
export interface MockResultsCopy {
  readonly heading: string;
  readonly retentionSentence: string;
  readonly runAgainLabel: string;
  readonly openLobbyLabel: string;
  readonly browseLeaguesLabel: string;
}

export interface MockResultsProps {
  readonly view: DraftStateView;
  /** In the same ranked order `START_DRAFT` snapshots — `GET /api/drafts/[draftId]/players`'s
   *  own docblock — which is what makes the board delta below a fact of THIS draft's own log
   *  rather than a live, still-moving ranking. */
  readonly players: readonly Player[];
  /** Null for a commissioner watching a mock without a team of their own — the roster and pick
   *  list below have nothing to say for that caller, so this component says only the heading,
   *  the retention line and the three next actions. */
  readonly myTeamId: string | null;
  readonly copy: MockResultsCopy;
  /**
   * The room's own way out (Step 2: "never a dead end") — real navigations, built by `DraftRoom`
   * so this component stays presentational, the same `primaryAction`/`secondaryAction` shape
   * `SeatTakenPanel` (`@/league-room/components/seat-taken-panel`) already uses for the same
   * reason: a results panel has no business owning routes.
   */
  readonly actions: {
    readonly runAgain: ReactNode;
    readonly openLobby: ReactNode;
    readonly browseLeagues: ReactNode;
  };
}

/**
 * One row per roster spot, in `view.slotConfig`'s own order (QB, then RB, then …) — never one
 * row per slot TYPE with several names crammed onto it, so "who is at my second RB spot" is a
 * fact this list states plainly rather than something a reader parses out of a comma list.
 */
function RosterSection({
  view,
  playersById,
  myTeamId,
}: {
  readonly view: DraftStateView;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTeamId: string;
}) {
  const bySpot = new Map((view.rosters[myTeamId] ?? []).map((spot) => [`${spot.slot}:${spot.slotIndex}`, spot]));
  return (
    <div className="flex flex-col gap-2">
      <h2 className={`${EYEBROW} text-text-muted`}>Your roster</h2>
      <ul aria-label="Your roster" className="flex flex-col gap-1.5">
        {view.slotConfig.flatMap((config) => {
          const position = SLOT_POSITION[config.slot];
          return Array.from({ length: config.count }, (_, slotIndex) => {
            const spot = bySpot.get(`${config.slot}:${slotIndex}`) ?? null;
            const name = spot?.playerId === null || spot?.playerId === undefined ? "Open" : playerName(playersById, spot.playerId);
            return (
              <li key={`${config.slot}:${slotIndex}`} className="flex flex-wrap items-center gap-2">
                {position === undefined ? <SlotChip slot={config.slot} /> : <PositionBadge position={position} size="sm" />}
                <span className="text-sm text-text-primary">{name}</span>
              </li>
            );
          });
        })}
      </ul>
    </div>
  );
}

function PickList({
  view,
  players,
  playersById,
  myTeamId,
}: {
  readonly view: DraftStateView;
  readonly players: readonly Player[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTeamId: string;
}) {
  const rank = rankByPlayerId(players);
  const myPicks = [...view.picks].filter((pick) => pick.teamId === myTeamId).sort((a, b) => a.pickNumber - b.pickNumber);
  return (
    <div className="flex flex-col gap-2">
      <h2 className={`${EYEBROW} text-text-muted`}>Your picks</h2>
      {myPicks.length === 0 ? (
        <p className="text-sm text-text-muted">You did not draft anyone in this room.</p>
      ) : (
        <ol aria-label="Your picks" className="flex flex-col gap-1">
          {myPicks.map((pick) => (
            <li key={pick.pickNumber} className="text-sm text-text-primary">
              {formatBoardDelta(playerName(playersById, pick.playerId), pick.pickNumber, rank.get(pick.playerId) ?? null)}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * The post-draft panel for a mock room (Task 8, Step 2). On `phase === "complete"`, `DraftRoom`
 * lets this yield the whole board: your roster grouped by slot, your pick list with each pick's
 * board delta (a fact of this draft's own log, computed from the pool order the draft itself
 * snapshotted at start — never a live ranking), the retention sentence, and the room's three
 * next actions.
 *
 * Deliberately NO letter grade (ruling 5) — a grade manufactures authority this platform has not
 * earned, and the real-only rule forbids it. The board delta is the honest version of the same
 * itch: what you actually took, against what the board actually said, both facts of this one
 * draft.
 */
export function MockResults({ view, players, myTeamId, copy, actions }: MockResultsProps) {
  const playersById = buildPlayersById(players);
  return (
    <section aria-label="Mock draft results" className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-display-md font-semibold leading-display text-text-primary">{copy.heading}</h1>
        <p className="text-sm text-text-muted">{copy.retentionSentence}</p>
      </div>
      {myTeamId === null ? null : (
        <div className="grid gap-6 sm:grid-cols-2">
          <RosterSection view={view} playersById={playersById} myTeamId={myTeamId} />
          <PickList view={view} players={players} playersById={playersById} myTeamId={myTeamId} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        {actions.runAgain}
        {actions.openLobby}
        {actions.browseLeagues}
      </div>
    </section>
  );
}
