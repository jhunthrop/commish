"use client";

import { memo, useMemo } from "react";
import type { Player } from "@/domain/player";
import { Button, MotionList, type MotionRowProps } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { useStableList } from "@/design/use-stable-list";
import { formatAdp } from "../../lib/tiers";
import type { SurvivalOdds } from "@/draft-service/assistant/view";
import { OddsFigure } from "../../advisor/components/odds-glance";
import { DrawerRow } from "./drawer-row";
import { PagedFooter, usePaging } from "./paged-list";
import type { RoomActs } from "./room-acts";

export interface DrawerByesTabProps extends Pick<RoomActs, "canDraft" | "submitting" | "onDraft" | "onPeek"> {
  /** The advisor's next-turn odds; `null` prints none. */
  readonly odds?: SurvivalOdds | null;
  readonly leagueId: string;
  /** Server-ranked, best first. */
  readonly players: readonly Player[];
  readonly available: ReadonlySet<string>;
  readonly byeWeeks: ReadonlyMap<string, number>;
}

interface ByeRowModel {
  readonly player: Player;
  readonly week: number | null;
  readonly survived: number | undefined;
  readonly runs: number | null;
}

interface ByeBand {
  readonly week: number | null;
  readonly rows: readonly ByeRowModel[];
}

const keyOf = (row: ByeRowModel): string => row.player.id;

function bandsOf(rows: readonly ByeRowModel[]): readonly ByeBand[] {
  const byWeek = new Map<number | null, ByeRowModel[]>();
  for (const row of rows) byWeek.set(row.week, [...(byWeek.get(row.week) ?? []), row]);
  const weeks = [...byWeek.keys()].sort((a, b) => (a ?? Number.POSITIVE_INFINITY) - (b ?? Number.POSITIVE_INFINITY));
  return weeks.map((week) => ({ week, rows: byWeek.get(week) ?? [] }));
}

interface ByeRowProps extends Pick<RoomActs, "canDraft" | "submitting" | "onDraft" | "onPeek"> {
  readonly leagueId: string;
  readonly item: ByeRowModel;
  readonly row: MotionRowProps;
}

const ByeRow = memo(function ByeRow({ leagueId, item, canDraft, submitting, onDraft, onPeek, row }: ByeRowProps) {
  const { player, survived, runs } = item;
  const adp = formatAdp(player.adp);
  return (
    <DrawerRow
      leagueId={leagueId}
      player={player}
      onPeek={onPeek}
      row={row}
      meta={
        <>
          {player.nflTeam}
          {adp === null ? "" : ` · ${adp}`}
        </>
      }
      verdict={runs === null || survived === undefined ? null : <OddsFigure survived={survived} runs={runs} />}
      actions={
        canDraft ? (
          <Button size="sm" variant="verb" disabled={submitting} onClick={() => onDraft(player.id)}>
            Draft
          </Button>
        ) : null
      }
    />
  );
});

/**
 * THE BYES TAB — who is left, banded by bye week, so a manager stacking one week can see it
 * before the roster does. The top of the board (the pool's own page, more on request), never
 * the whole pool at once. Each band is its own `MotionList`: a drafted player fades out of his
 * band in place and the band closes up behind him; unchanged rows keep their identity and skip.
 */
export function DrawerByesTab({ leagueId, players, available, byeWeeks, canDraft, submitting, onDraft, onPeek, odds = null }: DrawerByesTabProps) {
  const remaining = useMemo(() => players.filter((player) => available.has(player.id)), [players, available]);
  const paging = usePaging(remaining.length);
  const built = useMemo(() => {
    const runs = odds === null || odds.runs === 0 ? null : odds.runs;
    return remaining.slice(0, paging.shown).map((player): ByeRowModel => ({ player, week: byeWeeks.get(player.nflTeam) ?? null, survived: odds === null ? undefined : odds.survived[player.id], runs }));
  }, [remaining, paging.shown, byeWeeks, odds]);
  const rows = useStableList(built, keyOf);
  const bands = useMemo(() => bandsOf(rows), [rows]);

  if (bands.length === 0) {
    return <p className="text-sm text-text-faint">Nobody left to group. The pool is drafted out.</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      {bands.map((band) => (
        <section key={band.week ?? "none"} aria-label={band.week === null ? "No bye on record" : `Bye week ${band.week}`} className="flex flex-col gap-1">
          <h3 className={`${MICRO_LABEL} text-text-faint`}>
            {band.week === null ? "No bye on record" : `Bye ${band.week}`}
            <span className="ml-2 tabular-nums">{band.rows.length}</span>
          </h3>
          <ol className="flex flex-col gap-1">
            <MotionList items={band.rows} keyOf={keyOf}>
              {(item, row) => <ByeRow leagueId={leagueId} item={item} canDraft={canDraft} submitting={submitting} onDraft={onDraft} onPeek={onPeek} row={row} />}
            </MotionList>
          </ol>
        </section>
      ))}
      <ol>
        <PagedFooter paging={paging} total={remaining.length} />
      </ol>
    </div>
  );
}
