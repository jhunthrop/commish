"use client";

import { useMemo, useState } from "react";
import type { TeamStandingsRow } from "../contract";
import { Avatar, Badge, Button, EmptyState, Movement, Table, type TableColumn } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { formatPoints, formatRecord } from "../lib/format";

type SortKey = "rank" | "pointsFor" | "pointsAgainst";

/**
 * The canonical ranking — wins, then points for, then team id — is `computeStandings`', on
 * the server, and is never restated here. `rank` therefore sorts by nothing at all and simply
 * keeps the order the server sent. The other two sort by that number alone; because
 * `Array.prototype.sort` is stable, ties fall back to the server's ranking for free. That is
 * display, not a league rule.
 */
const ORDER_BY: Readonly<Record<SortKey, (row: TeamStandingsRow) => number>> = {
  rank: () => 0,
  pointsFor: (row) => row.pointsFor,
  pointsAgainst: (row) => row.pointsAgainst,
};

/**
 * The comparison set both judged columns rank inside, in the words a manager would use. It is one
 * phrase in two registers — the column head prints "vs the league" and `Stat` speaks "Top 8% of
 * the league." — which is why it is a bare noun phrase and not a sentence.
 *
 * A league IS the whole population here: unlike the matchup page, there is nothing wider to
 * compare a team's season against. The direction is what separates the two columns, and `Table`
 * states it out loud ("lower is better") rather than smuggling it into the phrase.
 */
const LEAGUE_POPULATION = "the league";

/** What the movement column is measured against, in the words the screen reader will say. */
const MOVEMENT_AGAINST = "last week";

export interface StandingsTableProps {
  readonly rows: readonly TeamStandingsRow[];
  readonly myTeamId: string | null;
  /**
   * Whether this league plays a median game (`LeagueHomeBody.medianGame`). A record already folds
   * the median game's win/loss/tie into the SAME `wins`/`losses`/`ties` a head-to-head result uses
   * (`computeStandings`'s own docblock) — invisible from a row alone — so this table needs the
   * fact stated, not inferred from the numbers it renders. It reaches the reader as the last
   * clause of the footnote, which is where a rule about how records are counted belongs.
   */
  readonly medianGame?: boolean;
  /**
   * `LEAGUE_CONFIG.playoffTeams`, threaded down from `LeaguePage` rather than value-imported here —
   * `src/league-room/**` may not import `@/league` as a value (`eslint.config.mjs`), and this
   * table has no other way to learn the real cut line. A plain constant threaded as a prop is not
   * new data: no query, no wire field. `undefined` (a test that doesn't care) draws no cut at all.
   */
  readonly playoffTeams?: number;
}

/** The team just OUTSIDE the playoff field, by real standings rank — never by whatever column
 *  the reader currently has the table sorted on. `rows` is the ORIGINAL, server-ranked array
 *  (never `ordered`, which a Points For/Against sort can reshuffle), so the cut marks the same
 *  boundary regardless of which column is currently driving the visible order. `undefined`
 *  `playoffTeams`, or a field as large as the league itself (the same degenerate case
 *  `showClinchBadges` already guards), draws nothing. */
function firstTeamOutId(rows: readonly TeamStandingsRow[], playoffTeams: number | undefined): string | null {
  if (playoffTeams === undefined || playoffTeams >= rows.length) return null;
  return rows[playoffTeams]?.teamId ?? null;
}

/**
 * THE STANDINGS AS A TIMING TOWER (Sunday v5).
 *
 * Four laws land on one table, and every one of them is a column decision:
 *
 * LAW 1 and LAW 2 — the numeral leads and the movement follows it. `3` is where a team sits; `▲2`
 * is what happened to them, and it is the tower's oldest trick: one narrow column turns a table
 * into a narrative. The previous ranking is REAL (`TeamStandingsRow.previousRank`, the same
 * `computeStandings` run a second time with the latest settled week held out), which is the only
 * reason the column is allowed to exist — law 7 forbids drawing a movement nobody measured, so a
 * league with no week behind it prints a dash and says nothing.
 *
 * LAW 3 — the team name is the display face at 18px, not body text at 13px. A tower drops a column
 * before it shrinks a name; this table dropped one (see the Record head below) and spent the width
 * on the two the reader came for.
 *
 * LAW 4 — the reader's own row wears the amber rail. Amber is furniture, you, and the verb, and
 * "you" on a leaderboard is exactly this: the one row of twelve a manager is looking for.
 *
 * LAW 5 — the playoff cut carries its consequence in words. It used to be a bare 2px hairline
 * above the first team out, which is a shape a reader has to be told the meaning of; the shape
 * stays (it is the channel that survives with colour off) and the words arrive with it.
 *
 * NO TIPS (founder ruling, 2026-08-28: *"the UX should explain itself, we shouldn't need tips"*).
 * The Record head carried an `InfoTip` — two of them, a median branch and a plain one — plus, for
 * a guided reader, a whole inline sentence rendered inside a table header. The head is now
 * "W-L-T", which reads as itself and needs no definition, and the median league's one genuinely
 * non-obvious fact ("records include each week's median game") stays in the footnote where it
 * always was.
 */
export function StandingsTable({ rows, myTeamId, medianGame = false, playoffTeams }: StandingsTableProps) {
  const [sort, setSort] = useState<SortKey>("rank");
  const ordered = useMemo(() => [...rows].sort((a, b) => ORDER_BY[sort](b) - ORDER_BY[sort](a)), [rows, sort]);

  // `clinchedTeamIds` reports every team clinched from week 1 whenever the playoff field is at
  // least as big as the league (`playoffTeams >= teamCount`) — a real branch, but a signal with
  // no information in it. Twelve meaningless badges are worse than none, so a whole-league
  // clinch is treated as "nothing to show" rather than rendered literally.
  const showClinchBadges = rows.length > 0 && rows.some((row) => !row.clinched);
  const firstOutId = firstTeamOutId(rows, playoffTeams);

  const sortable = (key: SortKey, label: string) => (
    <button type="button" className={sort === key ? "underline decoration-accent underline-offset-4" : "underline"} onClick={() => setSort(key)}>
      {`Sort by ${label}`}
    </button>
  );

  const columns: readonly TableColumn<TeamStandingsRow>[] = [
    {
      // THE POSITION NUMERAL. `row.rank` and never the render index: re-sorting by points must not
      // renumber the league. A seed is a fact about the season; the visible order is a reading aid.
      // `aria-hidden` — the row already announces its team, and a bare "3" spoken before a name is
      // noise; the movement cell beside it carries the spoken sentence for both.
      key: "rank",
      header: "#",
      cell: (row) => (
        <span
          aria-hidden="true"
          className={`font-display text-2xl font-extrabold leading-none tabular-nums ${
            row.teamId === myTeamId ? "text-accent" : "text-text-faint"
          }`}
        >
          {row.rank}
        </span>
      ),
    },
    {
      key: "team",
      header: "Team",
      cell: (row) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          {/* LAW 5, THE CUT'S CONSEQUENCE IN WORDS. The 2px rule above this row (see
              `rowClassName`) is the shape; this is what the shape means. It prints on exactly one
              row in the league and only when a real playoff field was passed in. */}
          {row.teamId === firstOutId ? <span className={`${MICRO_LABEL} text-text-faint`}>The cut · nobody below this line is in</span> : null}
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={row.ownerDisplayName} avatar={row.ownerAvatar} size="sm" />
            <span className="min-w-0 truncate font-display text-lg font-bold leading-display text-text-primary">{row.teamName}</span>
            {showClinchBadges && row.clinched ? <Badge tone="positive">Clinched</Badge> : null}
          </span>
        </span>
      ),
    },
    {
      // LAW 2. `previousRank - rank` because a SMALLER number is a better place: a team that went
      // from 5th to 3rd rose two, so the subtraction is the previous minus the current and not the
      // other way round. `null` is a league with nothing behind it — `Movement` is not rendered at
      // all, because a zero would read as "unchanged", which is a claim.
      key: "movement",
      header: "Move",
      cell: (row) =>
        row.previousRank === null ? (
          <span className="font-display text-xs text-text-faint">
            <span aria-hidden="true">—</span>
            <span className="sr-only">No ranking from {MOVEMENT_AGAINST} to compare against</span>
          </span>
        ) : (
          <Movement places={row.previousRank - row.rank} against={MOVEMENT_AGAINST} />
        ),
      hideOnNarrow: true,
    },
    {
      // "W-L-T" reads as itself. See this component's docblock for the tip that used to sit here.
      key: "record",
      header: "W-L-T",
      cell: (row) => <span className="font-display text-base font-bold tabular-nums text-text-primary">{formatRecord(row)}</span>,
    },
    // THE HEAT MAP. The two columns a reader cannot get from the row order — the record above is
    // what the table is sorted BY, so tinting it would spend the heat on a fact position already
    // tells, which is the "louder without making a true thing more legible" failure law 6 rejects.
    {
      key: "pointsFor",
      header: "Points for",
      judged: { value: (row) => row.pointsFor, format: formatPoints, set: LEAGUE_POPULATION },
    },
    {
      key: "pointsAgainst",
      header: "Points against",
      // The one column in this product where the biggest number is the worst one.
      judged: { value: (row) => row.pointsAgainst, format: formatPoints, set: LEAGUE_POPULATION, direction: "lower-is-better" },
      hideOnNarrow: true,
    },
  ];

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 className="font-display text-display-sm font-semibold leading-display text-text-primary">Standings</h2>
        <div className="flex flex-wrap gap-3 text-sm text-text-muted">
          {sortable("rank", "standing")}
          {sortable("pointsFor", "points for")}
          {sortable("pointsAgainst", "points against")}
        </div>
      </div>
      <Table
        caption="League standings"
        columns={columns}
        rows={ordered}
        rowKey={(row) => row.teamId}
        rowClassName={(row) => {
          // LAW 4, THE AMBER RAIL. The tower's "you" treatment, spelled exactly as `LeagueRow`
          // spells it on the open-league board: a 3px accent rail down the left edge and an
          // accent-glow wash falling away to the right. One row of twelve, found at a glance.
          const own = row.teamId === myTeamId ? "border-l-[3px] border-l-accent bg-gradient-to-r from-accent-glow via-transparent to-transparent " : "";
          // The playoff cut: a shape, never a colour — `border-t-edge` is a real 2px change every
          // reader sees, in either theme, whether or not they perceive colour at all. Its meaning
          // is printed in the Team cell above.
          const cut = row.teamId === firstOutId ? "border-t-2 border-t-edge" : "";
          return `${own}${cut}`;
        }}
        rowAttributes={(row) => ({ "data-own": row.teamId === myTeamId ? "true" : "false" })}
        empty={
          <EmptyState
            title="No results yet"
            description="Nothing scored yet."
            icon="trophy"
            action={<Button disabled>Waiting for the first week to be scored</Button>}
          />
        }
      />
      {rows.length === 0 ? null : (
        // The rule the server ranks by, said out loud: nobody should have to guess how a
        // 7-7 logjam resolves. (Persona review: veterans want the tiebreak named.)
        <p className="text-xs text-text-muted">
          Ties in the standings break on points for.
          {showClinchBadges ? " Clinched means a guaranteed playoff spot." : ""}
          {medianGame ? " Records include each week's median game." : ""}
        </p>
      )}
    </section>
  );
}
