"use client";

import { memo, useMemo } from "react";
import type { Player } from "@research/domain/player";
import { MotionList, PlayerFace, PositionBadge, type MotionRowProps } from "@/components/ui";
import { useStableList } from "@/design/use-stable-list";
import type { AdvisorView, Candidate } from "@/draft-service/assistant/view";
import type { PickCount } from "../config";
import type { AdvisorActs } from "./advisor-acts";
import { AdvisorVerb } from "./advisor-verb";
import { OddsFigure } from "./odds-glance";

export interface CandidateRowsProps {
  readonly view: AdvisorView;
  readonly acts: AdvisorActs;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly byeWeeks: ReadonlyMap<string, number>;
  /** How many candidates the tab shows in all, the lead card counted as the first. */
  readonly count: PickCount;
}

interface Row {
  readonly candidate: Candidate;
  readonly player: Player;
  /** 1-based place in the shortlist; the lead card is 1. */
  readonly rank: number;
  readonly meta: string;
  readonly survived: number | undefined;
  readonly runs: number | null;
}

const keyOf = (row: Row): string => row.candidate.playerId;

function metaText(player: Player, byeWeeks: ReadonlyMap<string, number>): string {
  const bye = byeWeeks.get(player.nflTeam);
  return bye === undefined ? player.nflTeam : `${player.nflTeam} · Bye ${bye}`;
}

/** The candidates after the lead, up to `count` in all, each paired with the room's own player
 *  facts. A candidate the room has no player for is left out rather than rendered blank. */
function rowsFor(view: AdvisorView, playersById: ReadonlyMap<string, Player>, byeWeeks: ReadonlyMap<string, number>, count: PickCount): readonly Row[] {
  const runs = view.odds === null || view.odds.runs === 0 ? null : view.odds.runs;
  return view.candidates.slice(1, count).flatMap((candidate, index) => {
    const player = playersById.get(candidate.playerId);
    if (player === undefined) return [];
    return [{ candidate, player, rank: index + 2, meta: metaText(player, byeWeeks), survived: view.odds?.survived[candidate.playerId], runs }];
  });
}

const CandidateRow = memo(function CandidateRow({ item, acts, row }: { readonly item: Row; readonly acts: AdvisorActs; readonly row: MotionRowProps }) {
  const { candidate, player, rank, meta, survived, runs } = item;
  return (
    <li {...row} data-testid="advisor-candidate" data-player-id={candidate.playerId} className={`flex items-center gap-2 rounded-sm bg-surface-raised px-2.5 py-1 ${row.className}`}>
      <span className="w-5 shrink-0 text-right font-display text-sm font-bold tabular-nums text-text-faint">{rank}</span>
      <PlayerFace player={player} size="sm" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-display text-md font-semibold text-text-primary">{player.name}</span>
          <PositionBadge position={candidate.position} rank={candidate.positionRank} size="sm" />
        </span>
        <span className="truncate text-xs text-text-faint">{meta}</span>
      </span>
      {runs === null || survived === undefined ? null : <OddsFigure survived={survived} runs={runs} form="runs" />}
      <AdvisorVerb playerId={candidate.playerId} acts={acts} name={player.name} />
    </li>
  );
});

/**
 * THE ROWS UNDER THE LEAD CARD: the rest of the shortlist as compact rows, rank, face, name,
 * position rank, team and bye, the same next-turn odds the card states as runs over runs in the
 * same three bands, and the same verb through the same room actions. Dense on purpose: ten of
 * these sit under the card without pushing anything off the phone.
 *
 * A recompute re-orders these; they slide to their new places (`MotionList`), a newcomer fades
 * in, a candidate the board took fades out where he stood, and a row whose facts did not change
 * does not re-render.
 */
export function CandidateRows({ view, acts, playersById, byeWeeks, count }: CandidateRowsProps) {
  const built = useMemo(() => rowsFor(view, playersById, byeWeeks, count), [view, playersById, byeWeeks, count]);
  const rows = useStableList(built, keyOf);
  if (rows.length === 0) return null;
  return (
    <ol data-testid="advisor-candidates" aria-label="Next best picks" className="relative flex flex-col gap-1">
      <MotionList items={rows} keyOf={keyOf}>
        {(item, row) => <CandidateRow item={item} acts={acts} row={row} />}
      </MotionList>
    </ol>
  );
}
