import type { Position } from "@/domain/player";
import type { MedianResult, WeekStatus } from "@/league";
import type { MatchupDetail, MatchupLineupEntry, MatchupSide } from "../contract";
import { BigNumber, Card, EYEBROW, Manager, PlayerFace, PositionBadge, SlotChip, Stat, Table, type TableColumn } from "@/components/ui";
import { PlayerName } from "./player-peek";
import { formatPoints } from "../lib/format";
import { playerOf } from "../lib/player";
import type { ManagerIdentity, ManagersByTeamId } from "../lib/managers";
import { summaryOf } from "../lib/matchup-facts";
import { starterComparison } from "../lib/population";
import { MatchupHero, SideChips, type RecordsByTeamId } from "./matchup-hero";
import { MedianResultLine } from "./median-result";
import { WeekStatusBadge } from "./week-status-badge";

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
function pointsStat(row: MatchupLineupEntry, points: number, positionPoints: PositionPoints | undefined) {
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
 * LAW 3, IN A TABLE CELL: *"a player is an object. Face, team colour, position, number — every
 * surface showing a player shows all four."* This column used to render `row.playerName` — a bare
 * string, the exact shape law 3 replaced.
 *
 * WHY IT IS A CELL AND NOT `PlayerRow`. Law 3 and law 4 both apply here and they pull in opposite
 * directions. Rule 4's amended test survives law 3 verbatim: *"a thing you act on or compare
 * against its neighbours may be a card; a thing you read down a column stays a row."* A starters
 * list is read down a column — nine slots, one after another, scanned for the number at the end —
 * and there is nothing to act on, so it stays a real `<table>` with the density law 4 asks for.
 * What changes is what fills the Player cell: the object, not the string. `PlayerRow` is the
 * card-shaped sibling for boards you act on, and using it here would trade a scannable column for
 * nine bordered tiles.
 *
 * THE MISSING FOURTH ATTRIBUTE IS THE JERSEY NUMBER, and it is missing everywhere in this product
 * for the same reason `PlayerFace`'s docblock records: the feed carries none, and an invented one
 * is worse than an absent one because a manager reads it as a fact. The club code stands in as the
 * text channel beside the colour, which is also what keeps the tile from being colour-only
 * information.
 *
 * An empty slot renders the word and nothing else. A slot with no player has no face to draw, and
 * a grey placeholder tile pretending to be somebody would be the same failure `PlayerFace` refuses
 * for an unknown club.
 */
function PlayerCell({ leagueId, row }: { readonly leagueId: string; readonly row: MatchupLineupEntry }) {
  const player = playerOf(row);
  if (player === null) {
    // An empty slot has no player to name, so the slot itself is the whole cell — the one row
    // where the chip is still the only thing that could be there.
    return (
      <span className="flex items-center gap-2">
        <SlotChip slot={row.slot} />
        <span className="text-text-faint">Empty</span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2">
      <PlayerFace player={player} size="sm" />
      <span className="flex min-w-0 flex-col leading-tight">
        <PlayerName leagueId={leagueId} playerId={player.id} name={player.name} className="truncate text-text-primary" />
        <span className="flex items-center gap-1.5">
          <PositionBadge position={player.position} size="sm" />
          {/* THE SLOT ONLY WHEN IT IS NOT THE POSITION (2026-08-28) — see `columnsFor`. On eight
              of nine starter rows "RB" in the slot chip and "RB" on the sticker are one fact
              printed twice, side by side, and the ninth is the only one anybody reads. */}
          {row.slot === player.position ? null : <SlotChip slot={row.slot} />}
          {player.nflTeam === "" ? null : <span className="font-mono text-xs text-text-faint">{player.nflTeam}</span>}
        </span>
      </span>
    </span>
  );
}

/**
 * TWO COLUMNS: who, and what he scored.
 *
 * THE SLOT COLUMN IS CUT (2026-08-28), which closes a duplication this table has been carrying
 * from both directions. NEW-10 deleted `Pos` because `Slot` and `Pos` were two columns for one
 * fact, identical on every row but FLEX. Gameday then put the position sticker back inside the
 * Player cell, where law 3 says it belongs — and quietly recreated the same duplication from the
 * other side: a nine-row lineup printed "RB" in a chip and "RB" on a sticker, an inch apart,
 * eight times. A column is worth its width when a manager acts on it, and nobody has ever read a
 * lineup's QB row to learn that the quarterback is playing quarterback.
 *
 * FLEX SURVIVES, which is the only thing that column was ever really saying. The chip renders
 * inside the Player cell exactly when the slot and the position disagree, so the one row a
 * manager actually looks for is the one row that carries a chip — the fact is now louder for
 * being rarer. An empty slot keeps its chip too: with no player to name, the slot IS the row.
 *
 * Nothing moves left into the reclaimed width. The table simply ends sooner.
 *
 * THE HEAT MAP lives in the Points column (the fun pass, Task 9), and it stays a hand-built
 * `Stat` rather than becoming `Table`'s declarative `judged` column. That is deliberate: a judged
 * column ranks its numbers against THE OTHER NUMBERS IN THAT COLUMN, and this column's nine
 * starters are nine different jobs. The real population is every starter at the same position
 * across every game in the week — a set this table cannot see, handed down as a prop. Declaring
 * it judged would rank a kicker against a quarterback for sharing a column. The head states the
 * set instead, in the same two registers a judged head uses, so a reader gets the same claim.
 */
function columnsFor(leagueId: string, positionPoints: PositionPoints | undefined): readonly TableColumn<MatchupLineupEntry>[] {
  return [
    { key: "player", header: "Player", cell: (row) => <PlayerCell leagueId={leagueId} row={row} /> },
    {
      key: "points",
      header: (
        <span className="flex flex-col items-end gap-0.5">
          <span>Points</span>
          {/* Stated only when there IS a population — an omitted `positionPoints` renders every
              cell as ordinary ink, and a head claiming a comparison the column did not make would
              be the exact dishonesty the tint is bound by. */}
          {positionPoints === undefined ? null : (
            <span className="normal-case tracking-normal text-text-faint">vs the week, by position</span>
          )}
        </span>
      ),
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

/**
 * One side's starters, under the team's own name.
 *
 * NO `Card` OF ITS OWN ANY MORE (Gameday, law 4). The two lineups used to sit in two bordered,
 * padded cards INSIDE the panel's own card, which is three nested surfaces for one matchup and the
 * "decorative whitespace" law 4 names by name. They are now two columns of one table pair under
 * one hairline, which fits both lineups and the hero above them in roughly the height the hero
 * alone used to take.
 */
function Side({
  leagueId,
  side,
  isMine,
  median,
  positionPoints,
  weekStatus,
  manager,
}: {
  readonly leagueId: string;
  readonly side: MatchupSide;
  readonly isMine: boolean;
  readonly weekStatus: WeekStatus;
  readonly median: { readonly score: number; readonly medianScore: number; readonly result: MedianResult } | null;
  readonly positionPoints: PositionPoints | undefined;
  readonly manager: ManagerIdentity | undefined;
}) {
  return (
    // `data-team-id` is a TEST CONTRACT, the same one `ScoreBug` carries: the fluidity spec pushes
    // `score.update` frames keyed on real team ids and has no other way to learn them from the
    // rendered page. Nothing on screen reads it.
    <div data-team-id={side.teamId} className="flex min-w-0 flex-col gap-1.5">
      {/* THE PERSON HEADS THE COLUMN, NOT THE TEAM (P1, Sideline 2026-09-10). This was an
          all-caps eyebrow carrying a team name, which is the exact shape P1's rules-out list
          names: a manager row that leads with a team name and no face. It is now a `Manager` pair
          with this side's own score as a small `BigNumber` at the end of it, so each half of the
          matchup is a person, their team and one number with its basis. A viewer's own side wears
          the amber ring and their rival the rose one, which is the only place this panel spends a
          pigment on who is who. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {manager === undefined ? (
          <h3 className={`${EYEBROW} text-text-muted`}>{side.teamName}</h3>
        ) : (
          <Manager
            name={manager.name}
            avatar={manager.avatar}
            size="md"
            ring={isMine ? "self" : "rival"}
            meta={`${side.teamName} · ${manager.record}`}
            className="flex-1"
            trailing={<BigNumber value={side.score === null ? null : formatPoints(side.score)} basis={isMine ? "yours, PPR" : "theirs, PPR"} size="sm" />}
          />
        )}
        {/* "Can I still win?", attached to the team it is about — see `SideChips`' own docblock
            for why these do not sit between the two scores. */}
        <SideChips side={side} mine={isMine} weekStatus={weekStatus} />
      </div>
      <Table
        caption={`${side.teamName} starters`}
        columns={columnsFor(leagueId, positionPoints)}
        rows={side.starters}
        rowKey={(row) => `${row.slot}:${row.slotIndex}`}
        empty={<p className="text-sm text-text-muted">No starters set.</p>}
      />
      {median === null ? null : (
        <MedianResultLine
          teamName={side.teamName}
          isMine={isMine}
          score={median.score}
          medianScore={median.medianScore}
          result={median.result}
        />
      )}
    </div>
  );
}

/**
 * Both lineups, side by side. Exported because TWO surfaces render exactly this and neither is
 * allowed to own a second copy: the hero panel below, and the disclosure inside `MatchupStrip`'s
 * own rows. The strip's whole argument is that collapsing the rest of the league costs a manager
 * nothing, and that is only true while the thing behind its rows is the identical lineup pair.
 */
export function MatchupLineups({
  leagueId,
  matchup,
  myTeamId,
  positionPoints,
  managers,
}: {
  readonly leagueId: string;
  readonly matchup: MatchupDetail;
  readonly myTeamId: string | null;
  readonly positionPoints?: PositionPoints;
  /** Every team's manager, joined by the page from the standings read it already makes
   *  (`managersFrom`). Omitted, each column falls back to its old team-name eyebrow rather than
   *  inventing a person. */
  readonly managers?: ManagersByTeamId;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
      <Side
        leagueId={leagueId}
        side={matchup.home}
        isMine={matchup.home.teamId === myTeamId}
        median={medianLineFor(matchup, "home")}
        positionPoints={positionPoints}
        weekStatus={matchup.weekStatus}
        manager={managers?.[matchup.home.teamId]}
      />
      <Side
        leagueId={leagueId}
        side={matchup.away}
        isMine={matchup.away.teamId === myTeamId}
        median={medianLineFor(matchup, "away")}
        positionPoints={positionPoints}
        weekStatus={matchup.weekStatus}
        manager={managers?.[matchup.away.teamId]}
      />
    </div>
  );
}

/**
 * ONE MATCHUP, DRAWN AS THE THING A MANAGER CAME FOR.
 *
 * The panel is one `Card`: the hero at the top (law 2's 84px pairing, spent), both lineups
 * beneath it as player objects (law 3), at table density (law 4). Before Gameday this was a
 * scoreboard card followed by two more cards, each holding a table of names — three nested
 * surfaces, six matchups deep, and a manager's own game somewhere in the middle of it.
 *
 * `weekStatus` is a prop of its own, not read off `matchup.weekStatus`: it decouples "what state
 * the week is in right now" from the server-rendered snapshot `matchup` carries, which is what
 * lets a caller fold a live `score.update` frame (`useLiveScores`) over it without having to
 * reconstruct the whole `MatchupDetail`.
 *
 * NO TIPS (founder ruling, 2026-08-28: *"the UX should explain itself, we shouldn't need tips"*).
 * The eyebrow carried the "matchup" glossary trigger. A screen showing two crests, two records and
 * two 84px scores under the word "Matchup" has already defined the term better than a paragraph
 * behind a button could, which is the whole substance of the ruling.
 */
export function MatchupPanel({
  leagueId,
  matchup,
  myTeamId,
  weekStatus,
  positionPoints,
  records,
  managers,
  eyebrow = "Matchup",
}: {
  readonly leagueId: string;
  readonly matchup: MatchupDetail;
  readonly myTeamId: string | null;
  readonly weekStatus: WeekStatus;
  /**
   * The week's own starters pooled by position (the fun pass, Task 9) — built by `LiveMatchupWeek`,
   * which is the only thing on this route that can see every matchup at once. Omit it and every
   * points cell renders as ordinary ink: law 1 permits magnitude only against a population that
   * genuinely exists, and one matchup is not a population.
   */
  readonly positionPoints?: PositionPoints;
  /** Every team's win-loss-tie line, joined by the page from the standings read it already makes
   *  (`MatchupHero`'s own `RecordsByTeamId`). Omit it and the hero prints no record rather than a
   *  fabricated 0-0. */
  readonly records?: RecordsByTeamId;
  /** Every team's manager (`managersFrom`), for the person at the head of each lineup column. */
  readonly managers?: ManagersByTeamId;
  /** What the panel calls itself. "Your matchup" for the viewer's own game, which is the one the
   *  page leads with; "Matchup" for everybody else's. A label, never a layout switch. */
  readonly eyebrow?: string;
}) {
  // D5: a real `<h2>` anchors this matchup — the document used to run `<h1>` straight into
  // `Side`'s own team-name heading with nothing in between, an axe `heading-order` failure at
  // both viewports. The heading is visually silent (`sr-only`): the eyebrow and hero already say
  // the same thing out loud, so `aria-labelledby` points the section at this heading instead of
  // repeating the text a second time as a plain `aria-label`.
  const headingId = `matchup-${matchup.home.teamId}-${matchup.away.teamId}`;
  return (
    <Card as="section" aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="sr-only">{`${matchup.home.teamName} against ${matchup.away.teamName}`}</h2>
      <div className="flex items-center justify-between gap-2">
        <span className={`${EYEBROW} text-text-muted`}>{eyebrow}</span>
        {/* `weekStatus`, never `matchup.final`: a week can be `in_progress` for hours before
            `final` flips, and `final` alone cannot tell that apart from `scheduled`. */}
        <WeekStatusBadge status={weekStatus} />
      </div>
      <MatchupHero matchup={summaryOf(matchup)} myTeamId={myTeamId} records={records} />
      <div className="border-t border-line pt-3">
        <MatchupLineups leagueId={leagueId} matchup={matchup} myTeamId={myTeamId} positionPoints={positionPoints} managers={managers} />
      </div>
    </Card>
  );
}
