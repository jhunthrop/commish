import { PlayerFace, SlotChip } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { NOT_STARTED_DASH } from "@/components/ui/game-state-chip";
import type { MatchupDetail, MatchupLineupEntry } from "../contract";
import { formatPoints } from "../lib/format";
import { playerOf } from "../lib/player";

/** One slot's pairing across the two lineups, keyed the way both sides' configs align. */
interface SlotPair {
  readonly key: string;
  readonly mine: MatchupLineupEntry | undefined;
  readonly theirs: MatchupLineupEntry | undefined;
}

function pairStarters(mine: readonly MatchupLineupEntry[], theirs: readonly MatchupLineupEntry[]): readonly SlotPair[] {
  const keyOf = (entry: MatchupLineupEntry): string => `${entry.slot}:${entry.slotIndex}`;
  const theirsByKey = new Map(theirs.map((entry) => [keyOf(entry), entry]));
  const keys = [...new Set([...mine.map(keyOf), ...theirs.map(keyOf)])];
  const mineByKey = new Map(mine.map((entry) => [keyOf(entry), entry]));
  return keys.map((key) => ({ key, mine: mineByKey.get(key), theirs: theirsByKey.get(key) }));
}

/** One side of one row: the player as an object, points at the slate's spine. */
function SlateSide({ entry, align }: { readonly entry: MatchupLineupEntry | undefined; readonly align: "left" | "right" }) {
  const player = entry === undefined ? null : playerOf(entry);
  const points = entry?.points ?? null;
  const identity =
    player === null ? (
      <span className="text-sm text-text-faint">Empty</span>
    ) : (
      <span className={`flex min-w-0 items-center gap-2 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
        <PlayerFace player={player} size="sm" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold leading-tight text-text-primary">{player.name}</span>
          <span className="truncate font-mono text-xs text-text-faint">
            {player.position}
            {player.nflTeam === "" ? "" : ` · ${player.nflTeam}`}
          </span>
        </span>
      </span>
    );
  const figure = (
    <span
      className={`shrink-0 font-display text-lg font-bold tabular-nums ${points === null ? "text-text-faint" : "text-text-primary"}`}
    >
      {points === null ? NOT_STARTED_DASH : formatPoints(points)}
    </span>
  );
  return (
    <div className={`flex min-w-0 items-center gap-3 ${align === "right" ? "flex-row-reverse" : ""} ${align === "left" ? "justify-between" : "justify-between"}`}>
      {identity}
      {figure}
    </div>
  );
}

export interface MatchupSlateProps {
  readonly detail: MatchupDetail;
  readonly myTeamId: string | null;
}

/**
 * THE SLATE (founder, 2026-08-29: "the matchup tab should show the score by player - think espn
 * fantasy"). ESPN's signature matchup view is the MIRROR: my starter and their starter on the
 * same row, the slot rail down the spine, each player's points at the spine's edge — so a
 * manager reads the game position by position, which is how a matchup is actually experienced.
 * A pair of separate lineup tables says the same numbers without the comparison, and law 1 says
 * the comparison is the story.
 *
 * Points sit at the SPINE, not the outer edges: the two figures for one slot land beside each
 * other with only the slot plate between them, which is what makes each row read as its own
 * little score bug. A player with no stat line prints the dash — "has not played" and "played
 * and scored nothing" are different facts (the contract's own rule), and the slate never
 * launders one into the other.
 *
 * Bench regret is deliberately not here: the slate is the game as fielded. The matchup page's
 * own chips carry the bench arithmetic for the one manager it belongs to.
 */
export function MatchupSlate({ detail, myTeamId }: MatchupSlateProps) {
  // HOME LEFT, AWAY RIGHT — the hero's own order, kept even when the viewer is the away side.
  // The first render put "mine" left and the two components disagreed about which side Bay
  // Bandits was on within one card; a page that swaps a team's side between its scoreboard and
  // its slate is lying about geometry. `myTeamId` still matters below: your side's column head
  // says so.
  const mine = detail.home;
  const theirs = detail.away;
  const pairs = pairStarters(mine.starters, theirs.starters);
  const homeIsMine = detail.home.teamId === myTeamId;
  const awayIsMine = detail.away.teamId === myTeamId;

  return (
    <div className="flex flex-col">
      <div aria-hidden="true" className={`grid grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] items-center gap-x-3 pb-1.5 ${MICRO_LABEL} text-text-faint`}>
        <span className="truncate">{homeIsMine ? `${mine.teamName} · you` : mine.teamName}</span>
        <span className="text-center">Slot</span>
        <span className="truncate text-right">{awayIsMine ? `${theirs.teamName} · you` : theirs.teamName}</span>
      </div>
      <ul className="flex flex-col">
        {pairs.map((pair) => (
          <li key={pair.key} className="grid grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] items-center gap-x-3 border-t border-line py-2">
            <SlateSide entry={pair.mine} align="left" />
            <SlotChip slot={(pair.mine ?? pair.theirs)!.slot} className="justify-self-center" />
            <SlateSide entry={pair.theirs} align="right" />
          </li>
        ))}
      </ul>
    </div>
  );
}
