"use client";

import { memo, useMemo, useRef } from "react";
import type { Player } from "@/domain/player";
import type { SurvivalOdds } from "@/draft-service/assistant/view";
import { BigNumber, Button, MotionList, PlayerRow, type MotionRowProps } from "@/components/ui";
import { useStableList } from "@/design/use-stable-list";
import { PlayerName } from "@/league-room/components/player-peek";
import { DRAFT_ROOM_CONFIG } from "../../state/config";
import { positionRanks } from "../../lib/tiers";
import { PoolFilterEmpty, PoolFilterRow, usePoolFilter } from "./pool-filter";
import type { RoomActs } from "./room-acts";

export interface PoolListProps extends RoomActs {
  readonly leagueId: string;
  /** Server-ranked, best first. Never re-ranked here. */
  readonly players: readonly Player[];
  readonly available: ReadonlySet<string>;
  readonly byeWeeks: ReadonlyMap<string, number>;
  readonly odds: SurvivalOdds | null;
  /** "3.07": the odds' basis; null when you have no next turn, and then no row prints one. */
  readonly nextPickLabel: string | null;
}

/** One row with every printed fact resolved to a primitive (the memo boundary). */
interface PoolRowModel {
  readonly player: Player;
  readonly positionRank: number | undefined;
  readonly bye: number | undefined;
  readonly survived: number | undefined;
  readonly runs: number | null;
}

const keyOf = (item: PoolRowModel): string => item.player.id;

interface PoolRowProps extends Pick<RoomActs, "canDraft" | "submitting" | "onDraft" | "onQueueToggle" | "onPeek"> {
  readonly leagueId: string;
  readonly item: PoolRowModel;
  readonly queued: boolean;
  readonly nextPickLabel: string | null;
  readonly row: MotionRowProps;
}

/**
 * ONE POOL ROW, Sideline's `PlayerRow`: the face on his club's ring, the name largest and
 * pressable (the season peek), the position and club and bye small, ONE number (how many runs
 * still have him at your next pick, with that basis under it), and the controls: the chevron
 * to this room's own card and Queue or a quiet Draft. The dock's big Draft is the room's one
 * solid pill (P3), so a row's Draft is the outlined one.
 */
const PoolRow = memo(function PoolRow({ leagueId, item, queued, nextPickLabel, canDraft, submitting, onDraft, onQueueToggle, onPeek, row }: PoolRowProps) {
  const { player, positionRank, bye, survived, runs } = item;
  return (
    <li {...row} data-testid="pool-row" data-player-id={player.id} className={`list-none ${row.className}`}>
      <PlayerRow
        player={player}
        positionRank={positionRank}
        name={<PlayerName leagueId={leagueId} playerId={player.id} name={player.name} className="max-w-full truncate" />}
        meta={
          <>
            <span data-testid="pool-player-team">{player.nflTeam}</span>
            {bye === undefined ? "" : ` · bye ${bye}`}
          </>
        }
        figure={
          nextPickLabel === null || runs === null ? null : (
            <BigNumber size="sm" value={survived === undefined ? null : String(survived)} basis={survived === undefined ? "no runs yet" : `of ${runs} runs at ${nextPickLabel}`} />
          )
        }
        action={
          <span className="flex items-center gap-1">
            <Button size="sm" variant="ghost" aria-label={`${player.name}'s draft card`} onClick={() => onPeek(player.id)}>
              <span aria-hidden="true" className="text-text-muted">
                ›
              </span>
            </Button>
            {canDraft ? (
              <Button size="sm" variant="secondary" disabled={submitting} aria-label={`Draft ${player.name}`} onClick={() => onDraft(player.id)}>
                Draft
              </Button>
            ) : (
              <Button size="sm" variant="secondary" disabled={submitting} aria-pressed={queued} aria-label={queued ? `Remove ${player.name} from your queue` : `Queue ${player.name}`} onClick={() => onQueueToggle(player.id)}>
                {queued ? "Queued" : "Queue"}
              </Button>
            )}
          </span>
        }
      />
    </li>
  );
});

/**
 * THE POOL (ruling 1: "the pool is the drawer"): search, the six position stickers, and the
 * ranked list of who is left, one page deep. Rows ride `MotionList`, so the row a pick took
 * fades out in place and everything below glides up; each row is memoized over primitives, so
 * sixty rows cost one row's render per pick.
 */
export function PoolList({ leagueId, players, available, byeWeeks, odds, nextPickLabel, canDraft, submitting, queuedPlayerIds, onDraft, onQueueToggle, onPeek }: PoolListProps) {
  const filter = usePoolFilter();
  const { matches } = filter;
  const searchRef = useRef<HTMLInputElement | null>(null);
  const ranks = useMemo(() => positionRanks(players), [players]);
  const rows = useMemo(() => players.filter((player) => available.has(player.id) && matches(player)), [players, available, matches]);
  const visible = useMemo(() => rows.slice(0, DRAFT_ROOM_CONFIG.poolPageSize), [rows]);
  const runs = odds === null || odds.runs === 0 ? null : odds.runs;
  const built = useMemo(
    (): readonly PoolRowModel[] => visible.map((player) => ({ player, positionRank: ranks.get(player.id), bye: byeWeeks.get(player.nflTeam), survived: odds?.survived[player.id], runs })),
    [visible, ranks, byeWeeks, odds, runs],
  );
  const items = useStableList(built, keyOf);

  return (
    <div id="player-pool" className="flex min-h-0 flex-1 flex-col gap-1.5">
      <PoolFilterRow filter={filter} searchRef={searchRef} />
      {visible.length === 0 ? (
        <PoolFilterEmpty filter={filter} />
      ) : (
        <ol aria-label="Available players, best first" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          <MotionList items={items} keyOf={keyOf}>
            {(item, row) => (
              <PoolRow
                leagueId={leagueId}
                item={item}
                queued={queuedPlayerIds.has(item.player.id)}
                nextPickLabel={nextPickLabel}
                canDraft={canDraft}
                submitting={submitting}
                onDraft={onDraft}
                onQueueToggle={onQueueToggle}
                onPeek={onPeek}
                row={row}
              />
            )}
          </MotionList>
          {rows.length > visible.length ? (
            <li className="px-2.5 py-1.5 text-xs text-text-faint tabular-nums">
              The top {visible.length} of {rows.length}. Search for anyone deeper.
            </li>
          ) : null}
        </ol>
      )}
    </div>
  );
}
