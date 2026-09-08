import type { Player } from "@/domain/player";
import { PlayerFace, PositionBadge } from "@/components/ui";
import type { AdvisorView, Candidate } from "@/draft-service/assistant/view";
import type { PickCount } from "../config";
import type { AdvisorActs } from "./advisor-acts";
import { AdvisorVerb } from "./advisor-verb";
import { OddsGlance } from "./odds-glance";

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
}

/** The candidates after the lead, up to `count` in all, each paired with the room's own player
 *  facts. A candidate the room has no player for is left out rather than rendered blank. */
function rowsFor(view: AdvisorView, playersById: ReadonlyMap<string, Player>, count: PickCount): readonly Row[] {
  return view.candidates.slice(1, count).flatMap((candidate, index) => {
    const player = playersById.get(candidate.playerId);
    return player === undefined ? [] : [{ candidate, player, rank: index + 2 }];
  });
}

function metaText(player: Player, byeWeeks: ReadonlyMap<string, number>): string {
  const bye = byeWeeks.get(player.nflTeam);
  return bye === undefined ? player.nflTeam : `${player.nflTeam} · Bye ${bye}`;
}

/**
 * THE ROWS UNDER THE LEAD CARD: the rest of the shortlist as compact rows, rank, face, name,
 * position rank, team and bye, the same next-turn odds the card states as runs over runs in the
 * same three bands, and the same verb through the same room actions. Dense on purpose: ten of
 * these sit under the card without pushing anything off the phone.
 */
export function CandidateRows({ view, acts, playersById, byeWeeks, count }: CandidateRowsProps) {
  const rows = rowsFor(view, playersById, count);
  if (rows.length === 0) return null;
  return (
    <ol data-testid="advisor-candidates" aria-label="Next best picks" className="flex flex-col gap-1">
      {rows.map(({ candidate, player, rank }) => (
        <li key={candidate.playerId} data-testid="advisor-candidate" data-player-id={candidate.playerId} className="flex items-center gap-2 rounded-sm bg-surface-raised px-2.5 py-1">
          <span className="w-5 shrink-0 text-right font-display text-sm font-bold tabular-nums text-text-faint">{rank}</span>
          <PlayerFace player={player} size="sm" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-display text-md font-semibold text-text-primary">{player.name}</span>
              <PositionBadge position={candidate.position} rank={candidate.positionRank} size="sm" />
            </span>
            <span className="truncate text-xs text-text-faint">{metaText(player, byeWeeks)}</span>
          </span>
          {view.odds === null ? null : <OddsGlance odds={view.odds} playerId={candidate.playerId} form="runs" />}
          <AdvisorVerb playerId={candidate.playerId} acts={acts} name={player.name} />
        </li>
      ))}
    </ol>
  );
}
