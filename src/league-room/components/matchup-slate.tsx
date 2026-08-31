import { PlayerFace, SlotChip } from "@/components/ui";
import { PlayerName } from "./player-peek";
import { LiveMarker } from "@/components/ui/live-marker";
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

/**
 * One side of one row — THE STANDARD, COPIED (founder, 2026-08-29: "It doesn't make sense to me
 * when i first look at it - other fantasy platforms have figured this out - just copy one of
 * them"). The first cut stacked three clever channels on one row: magnitude tints against the
 * field, winner weight, a 3px share bar with an orphaned margin under the plate. Rendered, the
 * red on a 6.00 kicker read as "something is wrong with him" and the spine figures belonged to
 * nobody. Every incumbent uses ONE device here and it is this: points are plain, and the slot's
 * winner is BRIGHTER AND HEAVIER than the loser. That is the whole grammar — a manager scans
 * the bright side of the spine and knows where the game was won.
 *
 * The field-relative verdict is a real fact with a real home: the player's own page. It does not
 * belong on the matchup, where colour gets read as status.
 */
function SlateSide({ entry, align, wonSlot, leagueId }: { readonly entry: MatchupLineupEntry | undefined; readonly align: "left" | "right"; readonly wonSlot: boolean; readonly leagueId: string }) {
  const player = entry === undefined ? null : playerOf(entry);
  const points = entry?.points ?? null;
  const identity =
    player === null ? (
      <span className="text-sm text-text-faint">Empty</span>
    ) : (
      <span className={`flex min-w-0 items-center gap-2 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
        <PlayerFace player={player} size="md" />
        <span className="flex min-w-0 flex-col">
          <PlayerName leagueId={leagueId} playerId={player.id} name={player.name} className="truncate text-lg font-semibold leading-tight text-text-primary" />
          <span className="truncate font-mono text-sm text-text-faint">
            {player.position}
            {player.nflTeam === "" ? "" : ` · ${player.nflTeam}`}
          </span>
        </span>
      </span>
    );
  const figure = (
    <span
      data-slot-winner={wonSlot ? "true" : undefined}
      className={`shrink-0 font-display tabular-nums ${
        points === null
          ? "text-base font-semibold text-text-faint/60"
          : wonSlot
            ? "text-2xl font-extrabold text-text-primary"
            : "text-xl font-semibold text-text-muted"
      }`}
    >
      {points === null ? NOT_STARTED_DASH : formatPoints(points)}
    </span>
  );
  return (
    <div className={`flex min-w-0 items-center justify-between gap-3 ${align === "right" ? "flex-row-reverse" : ""}`}>
      {identity}
      {figure}
    </div>
  );
}

export interface MatchupSlateProps {
  readonly detail: MatchupDetail;
  readonly myTeamId: string | null;
  /** For the pressable names (founder, 2026-08-30): the peek needs the league whose rules score him. */
  readonly leagueId: string;
}

/** Starters still without a stat line — the casual persona's one unanswered question ("who's
 *  left to play"), said per side, only while the week is genuinely live. A settled week has
 *  nobody left by definition and a scheduled one has everybody, and both prints would be noise. */
function yetToPlay(entries: readonly MatchupLineupEntry[]): number {
  return entries.filter((entry) => entry.playerId !== null && entry.points === null).length;
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
export function MatchupSlate({ detail, myTeamId, leagueId }: MatchupSlateProps) {
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
    // FULL WIDTH (founder, 2026-08-30: "all of these screens need to scale to the window
    // size", superseding the same day's max-w-3xl scan cap). The scan survives the width
    // because each side's figure sits at the SPINE edge, not the outer edge — the two vertical
    // strokes down the middle are unchanged however far the names stretch.
    <div
      className={`mx-auto flex w-full flex-col border-l-[3px] border-r-[3px] pl-2 pr-2 ${
        homeIsMine ? "border-l-accent border-r-transparent" : awayIsMine ? "border-l-transparent border-r-accent" : "border-l-transparent border-r-transparent"
      }`}
    >
      <div aria-hidden="true" className={`grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] items-center gap-x-4 pb-1.5 ${MICRO_LABEL} text-text-faint`}>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{homeIsMine ? `${mine.teamName} · you` : mine.teamName}</span>
          {detail.weekStatus === "in_progress" && yetToPlay(mine.starters) > 0 ? (
            <LiveMarker mono>{`${yetToPlay(mine.starters)} to play`}</LiveMarker>
          ) : null}
        </span>
        <span className="text-center">Slot</span>
        <span className="flex min-w-0 items-center justify-end gap-2">
          {detail.weekStatus === "in_progress" && yetToPlay(theirs.starters) > 0 ? (
            <LiveMarker mono>{`${yetToPlay(theirs.starters)} to play`}</LiveMarker>
          ) : null}
          <span className="truncate text-right">{awayIsMine ? `${theirs.teamName} · you` : theirs.teamName}</span>
        </span>
      </div>
      <ul className="flex flex-col">
        {pairs.map((pair) => (
          <li key={pair.key} className="grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] items-center gap-x-4 border-t border-line py-3">
            <SlateSide
              entry={pair.mine}
              align="left"
              leagueId={leagueId}
              wonSlot={pair.mine?.points != null && pair.mine.points > (pair.theirs?.points ?? -Infinity)}
            />
            <SlotChip slot={(pair.mine ?? pair.theirs)!.slot} className="justify-self-center" />
            <SlateSide
              entry={pair.theirs}
              align="right"
              leagueId={leagueId}
              wonSlot={pair.theirs?.points != null && pair.theirs.points > (pair.mine?.points ?? -Infinity)}
            />
          </li>
        ))}
      </ul>

      {/* THE BENCHES (the veteran persona: "I judge a win by what didn't start"). A native
          disclosure, OPEN by default since the tab loop (2026-08-30, maximize the space): a
          settled matchup's post-mortem IS the benches, and hiding them left a void. Muted
          throughout and NO winner emphasis: nobody wins a bench. */}
      {mine.bench.length === 0 && theirs.bench.length === 0 ? null : (
        <details open className="border-t border-line pt-2">
          <summary className={`${MICRO_LABEL} cursor-pointer list-none text-text-faint hover:text-text-muted`}>
            Benches
          </summary>
          <ul className="flex flex-col pt-1">
            {pairStarters(mine.bench, theirs.bench).map((pair) => (
              <li key={`bench-${pair.key}`} className="grid grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] items-center gap-x-3 border-t border-hair border-t-line/50 py-1.5 opacity-80">
                <SlateSide entry={pair.mine} align="left" leagueId={leagueId} wonSlot={false} />
                <span className={`${MICRO_LABEL} justify-self-center text-text-faint`}>BN</span>
                <SlateSide entry={pair.theirs} align="right" leagueId={leagueId} wonSlot={false} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
