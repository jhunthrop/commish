import { PlayerFace, SlotChip, Stat } from "@/components/ui";
import { MICRO_LABEL, UI_CONFIG } from "@/components/ui/config";
import { NOT_STARTED_DASH } from "@/components/ui/game-state-chip";
import type { MatchupDetail, MatchupLineupEntry } from "../contract";
import { formatPoints } from "../lib/format";
import { playerOf } from "../lib/player";

/**
 * THE SPINE CELL — the slot plate over a per-slot share bar and its margin (founder, 2026-08-29:
 * "it should show how each player is doing relative to each other"). The bar is PROPORTION, not
 * verdict: the left fill is the left player's share of the pair's points, drawn in plain ink on
 * the inset track, so a 19-to-14 slot reads as a lean and a 23-to-9 slot reads as a rout before
 * any number is read. The margin beneath it is the pair's delta, mono and muted — a fact about
 * a pair, which is why neither takes a magnitude tint (the pair-is-not-a-population rule; the
 * heat on the figures either side already carries the against-the-field verdict).
 *
 * Both render only when BOTH sides have played: a share of one number is not a comparison, and
 * a margin against a dash is an invented lead.
 */
function SpineCell({ slot, mine, theirs }: { readonly slot: MatchupLineupEntry["slot"]; readonly mine: number | null; readonly theirs: number | null }) {
  const both = mine !== null && theirs !== null;
  const total = both ? mine + theirs : 0;
  const share = both && total > 0 ? mine / total : 0.5;
  const margin = both ? Math.abs(mine - theirs) : null;
  return (
    <div className="flex w-full flex-col items-center gap-1 justify-self-center">
      <SlotChip slot={slot} />
      {both ? (
        <>
          <span aria-hidden="true" className="block h-[3px] w-full overflow-hidden rounded-pill bg-surface-inset">
            <span className="block h-full rounded-pill bg-text-muted" style={{ width: `${Math.round(share * 100)}%` }} />
          </span>
          <span className="font-mono text-[10px] tabular-nums leading-none text-text-faint">
            <span aria-hidden="true">{margin !== null && margin > 0 ? `+${formatPoints(margin)}` : "even"}</span>
            <span className="sr-only">{margin === null ? "" : margin === 0 ? "This slot is even." : `${mine! > theirs! ? "Left" : "Right"} side leads this slot by ${formatPoints(margin)}.`}</span>
          </span>
        </>
      ) : null}
    </div>
  );
}

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
 * One side of one row: the player as an object, the points JUDGED at the slate's spine.
 *
 * TWO VERDICTS PER ROW (founder, 2026-08-29: "it still looks boring and plain - make it feel
 * alive"). Plainness was every figure rendering as a fact — same ink, same weight, no verdict
 * anywhere on a card that holds two honest ones:
 *
 * - THE HEAT: each figure is tinted against the matchup's own starters — a real, stated
 *   population of ~18, above the floor — through `Stat`, the one component allowed to name a
 *   magnitude pigment. Your 23.80 burns strong, the 1.00 kicker reads bad, and the caret and
 *   weight step ride along so colour is never the only channel.
 * - THE SLOT WINNER: the higher figure in a settled pairing takes the display face's 800 and
 *   `data-slot-winner`; the loser stays at 700. A head-to-head is a pair, so it earns WEIGHT,
 *   never a tint of its own — the pair-is-not-a-population rule, held for the third time.
 */
function SlateSide({
  entry,
  align,
  wonSlot,
  comparison,
}: {
  readonly entry: MatchupLineupEntry | undefined;
  readonly align: "left" | "right";
  readonly wonSlot: boolean;
  readonly comparison: { readonly percentile: number; readonly population: string } | undefined;
}) {
  const player = entry === undefined ? null : playerOf(entry);
  const points = entry?.points ?? null;
  const identity =
    player === null ? (
      <span className="text-sm text-text-faint">Empty</span>
    ) : (
      <span className={`flex min-w-0 items-center gap-2 ${align === "right" ? "flex-row-reverse text-right" : ""}`}>
        <PlayerFace player={player} size="sm" />
        <span className="flex min-w-0 flex-col">
          <span className={`truncate text-sm leading-tight text-text-primary ${wonSlot ? "font-display font-bold" : "font-semibold"}`}>
            {player.name}
          </span>
          <span className="truncate font-mono text-xs text-text-faint">
            {player.position}
            {player.nflTeam === "" ? "" : ` · ${player.nflTeam}`}
          </span>
        </span>
      </span>
    );
  const figure =
    points === null ? (
      <span className="shrink-0 font-display text-lg font-bold tabular-nums text-text-faint">{NOT_STARTED_DASH}</span>
    ) : (
      <span className="shrink-0" data-slot-winner={wonSlot ? "true" : undefined}>
        <Stat label="Points" srOnlyLabel value={formatPoints(points)} size="md" comparison={comparison} />
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

  // THE POPULATION: every starter in this matchup with a real stat line — one stated set, both
  // columns judged against it. Below the floor (a week barely begun) nothing tints, which is the
  // refusal that keeps the heat honest.
  const allPoints = [...mine.starters, ...theirs.starters]
    .map((entry) => entry.points)
    .filter((points): points is number => points !== null)
    .sort((a, b) => a - b);
  const comparisonFor = (points: number | null) => {
    if (points === null || allPoints.length < UI_CONFIG.stat.minPopulation) return undefined;
    const below = allPoints.filter((value) => value < points).length;
    return { percentile: below / Math.max(1, allPoints.length - 1), population: "the starters in this matchup" };
  };

  return (
    <div
      className={`flex flex-col border-l-[3px] border-r-[3px] pl-2 pr-2 ${
        homeIsMine ? "border-l-accent border-r-transparent" : awayIsMine ? "border-l-transparent border-r-accent" : "border-l-transparent border-r-transparent"
      }`}
    >
      <div aria-hidden="true" className={`grid grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] items-center gap-x-3 pb-1.5 ${MICRO_LABEL} text-text-faint`}>
        <span className="truncate">{homeIsMine ? `${mine.teamName} · you` : mine.teamName}</span>
        <span className="text-center">Slot</span>
        <span className="truncate text-right">{awayIsMine ? `${theirs.teamName} · you` : theirs.teamName}</span>
      </div>
      <ul className="flex flex-col">
        {pairs.map((pair) => (
          <li key={pair.key} className="grid grid-cols-[minmax(0,1fr)_64px_minmax(0,1fr)] items-center gap-x-3 border-t border-line py-2">
            <SlateSide
              entry={pair.mine}
              align="left"
              wonSlot={pair.mine?.points !== null && pair.mine !== undefined && (pair.theirs?.points === null || pair.theirs === undefined || pair.mine.points! > (pair.theirs.points ?? -Infinity))}
              comparison={comparisonFor(pair.mine?.points ?? null)}
            />
            <SpineCell slot={(pair.mine ?? pair.theirs)!.slot} mine={pair.mine?.points ?? null} theirs={pair.theirs?.points ?? null} />
            <SlateSide
              entry={pair.theirs}
              align="right"
              wonSlot={pair.theirs?.points !== null && pair.theirs !== undefined && (pair.mine?.points === null || pair.mine === undefined || pair.theirs.points! > (pair.mine.points ?? -Infinity))}
              comparison={comparisonFor(pair.theirs?.points ?? null)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
