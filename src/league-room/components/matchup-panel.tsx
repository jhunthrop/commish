import type { Position } from "@/domain/player";
import type { MedianResult, WeekStatus } from "@/league";
import type { MatchupDetail, MatchupSide } from "../contract";
import { Card, EYEBROW, InfoTip, SlotChip, Stat, Table, type TableColumn } from "@/components/ui";
import { formatPoints } from "../lib/format";
import { starterComparison } from "../lib/population";
import { MatchupScoreboard } from "./matchup-scoreboard";
import { MedianResultLine } from "./median-result";

/** Every point total a starter put up this week, pooled by position — `startedPointsByPosition`
 *  (`../lib/population.ts`), built once by the page that can actually see the whole week. */
export type PositionPoints = ReadonlyMap<Position, readonly number[]>;

/**
 * One scored starter's points, as a heat-coloured number (the fun pass, Task 9). Takes `points`
 * separately from `row` so the not-yet-played case is settled by the caller and this function is
 * never handed a `null` to assert away.
 *
 * `srOnlyLabel`: the `<th>` above already says "Points", on screen and in the accessibility tree,
 * for every cell in this column. `items-end` because a `Stat` is a flex column and this one lives
 * in a `numeric` (right-aligned) cell.
 */
function pointsStat(row: MatchupSide["starters"][number], points: number, positionPoints: PositionPoints | undefined) {
  return (
    <Stat
      label="Points"
      srOnlyLabel
      size="sm"
      value={formatPoints(points)}
      comparison={positionPoints === undefined ? undefined : starterComparison(positionPoints, row.position, points)}
      className="items-end"
    />
  );
}

/**
 * NEW-10 (gauntlet fix wave): `Slot` and `Pos` used to be two columns for one fact — identical
 * for every row but FLEX, at ~15% of the table's width each. `Slot` is the one that survives:
 * `LineupEditor`'s own roster table (`lineup-editor.tsx`) already shows only the slot, the same
 * precedent this table now matches, and `SlotChip` alone still tells FLEX and BENCH apart from a
 * starting position — the one thing `Pos` (`PositionBadge`) added beyond `Slot` for six of nine
 * rows was nothing.
 *
 * THE HEAT MAP lives in the Points column (the fun pass, Task 9). Built per render rather than
 * hoisted to a module constant because the cell needs the week's population, which is a prop —
 * and a population is the ONLY thing that can tint a number here.
 */
function columnsFor(positionPoints: PositionPoints | undefined): readonly TableColumn<MatchupSide["starters"][number]>[] {
  return [
    { key: "slot", header: "Slot", cell: (row) => <SlotChip slot={row.slot} /> },
    { key: "player", header: "Player", cell: (row) => row.playerName ?? "Empty" },
    {
      key: "points",
      header: "Points",
      // D4: `null` means this player has no stat line for the week yet — not-yet-played, never a
      // silent zero. The same dash the team-level score already renders for the identical fact,
      // and the one case that renders no `Stat` at all: a dash is not a number, and a number that
      // does not exist cannot be ranked against anything.
      cell: (row) => (row.points === null ? "—" : pointsStat(row, row.points, positionPoints)),
      numeric: true,
    },
  ];
}

/** One side's own median line, or `null` when there's nothing to say yet — the toggle is off,
 *  or this week hasn't settled, or (defensively) this side has no score despite a median
 *  existing, a combination `finalizeWeekInTx`'s own single transaction never actually produces. */
function medianLineFor(
  matchup: MatchupDetail,
  which: "home" | "away",
): { readonly score: number; readonly medianScore: number; readonly result: MedianResult } | null {
  const { median } = matchup;
  const score = matchup[which].score;
  if (median === null || score === null) return null;
  return { score, medianScore: median.score, result: which === "home" ? median.homeResult : median.awayResult };
}

function Side({
  side,
  myTeamId,
  median,
  positionPoints,
}: {
  readonly side: MatchupSide;
  readonly myTeamId: string | null;
  readonly median: { readonly score: number; readonly medianScore: number; readonly result: MedianResult } | null;
  readonly positionPoints: PositionPoints | undefined;
}) {
  // The score lives on the scoreboard above; down here the roster is the story.
  return (
    <Card>
      <h3 className="font-display text-lg font-semibold leading-display text-text-primary">{side.teamName}</h3>
      {median === null ? null : (
        <MedianResultLine
          teamName={side.teamName}
          isMine={side.teamId === myTeamId}
          score={median.score}
          medianScore={median.medianScore}
          result={median.result}
        />
      )}
      {/* No explicit `density`: `Table` defaults to `"dense"` itself since Task 12 Step 3c's
          closeout (`table.tsx`'s own DENSITY-DEFAULT DECISION docblock). */}
      <Table
        caption={`${side.teamName} starters`}
        columns={columnsFor(positionPoints)}
        rows={side.starters}
        rowKey={(row) => `${row.slot}:${row.slotIndex}`}
        empty={<p className="text-sm text-text-muted">No starters set.</p>}
      />
    </Card>
  );
}

/**
 * One matchup, both lineups, every number already computed on the server.
 *
 * `weekStatus` is a prop of its own, not read off `matchup.weekStatus`: it decouples "what
 * state the week is in right now" from the server-rendered snapshot `matchup` carries, which is
 * what lets a caller fold a live `score.update` frame (`useLiveScores`) over it without having
 * to reconstruct the whole `MatchupDetail`. Live scoring exists now, so a week says which of
 * the three states it's in — scheduled, in progress, or final — and never shows a moving number
 * with no state beside it.
 *
 * A15: the "matchup" glossary term's own `InfoTip` caller — read off this file per the
 * backend-leverage inventory's Task 15 Step 4 ledger. Placed on this panel's own eyebrow rather
 * than on `MatchupScoreboard` itself: the scoreboard is ALSO `HomeLeagueCard`'s hero (Task 10),
 * a dense card-list context whose own test pins "no button at all" for a league with nothing
 * pending, and an unconditional InfoTip trigger there would be a real regression on a component
 * this task does not own.
 */
export function MatchupPanel({
  matchup,
  myTeamId,
  weekStatus,
  gamesFinal,
  gamesTotal,
  positionPoints,
}: {
  readonly matchup: MatchupDetail;
  readonly myTeamId: string | null;
  readonly weekStatus: WeekStatus;
  /**
   * The week's own starters pooled by position (the fun pass, Task 9) — built by `LiveMatchupWeek`,
   * which is the only thing on this route that can see every matchup at once. Omit it and every
   * points cell renders as ordinary ink: rule 1's amendment permits magnitude only against a
   * population that genuinely exists, and one matchup is not a population. Optional so the panel's
   * other callers (and every test that does not care) render exactly as they did before.
   */
  readonly positionPoints?: PositionPoints;
  /** E1(a)/D2: the week's own `stat_weeks.games_final`/`games_total`, live-folded upstream
   *  (`LiveMatchupWeek`) — optional so every OTHER existing caller of this panel is unaffected;
   *  the matchup page (the one production caller) always supplies both. */
  readonly gamesFinal?: number;
  readonly gamesTotal?: number;
}) {
  // D5: a real `<h2>` anchors this matchup — the document used to run `<h1>` straight into
  // `Side`'s own team-name `<h3>` with nothing in between (`MatchupPanel` gave each matchup an
  // eyebrow `<span>`, never a heading), an axe `heading-order` failure at both viewports. The
  // heading is visually silent (`sr-only`): the eyebrow and scoreboard already say the same
  // thing out loud, so `aria-labelledby` points the section at this heading instead of
  // repeating the text a second time as a plain `aria-label`.
  const headingId = `matchup-${matchup.home.teamId}-${matchup.away.teamId}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="sr-only">{`${matchup.home.teamName} against ${matchup.away.teamName}`}</h2>
      <span className="flex items-center gap-1">
        <span className={`${EYEBROW} text-text-muted`}>Matchup</span>
        <InfoTip term="matchup" />
      </span>
      <MatchupScoreboard
        matchup={{
          weekNumber: matchup.weekNumber,
          homeTeamId: matchup.home.teamId,
          awayTeamId: matchup.away.teamId,
          homeTeamName: matchup.home.teamName,
          awayTeamName: matchup.away.teamName,
          homeScore: matchup.home.score,
          awayScore: matchup.away.score,
          final: matchup.final,
          weekStatus,
        }}
        myTeamId={myTeamId}
        gamesFinal={gamesFinal}
        gamesTotal={gamesTotal}
        size="hero"
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <Side side={matchup.home} myTeamId={myTeamId} median={medianLineFor(matchup, "home")} positionPoints={positionPoints} />
        <Side side={matchup.away} myTeamId={myTeamId} median={medianLineFor(matchup, "away")} positionPoints={positionPoints} />
      </div>
    </section>
  );
}
