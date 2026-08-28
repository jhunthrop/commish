"use client";

import { useMemo, useState } from "react";
import type { TeamStandingsRow } from "../contract";
import { Avatar, Badge, Button, EmptyState, InfoTip, Stat, Table, type TableColumn } from "@/components/ui";
import type { HelpLevel } from "@/identity/preferences";
import { formatPoints, formatRecord } from "../lib/format";
import { comparisonWithin } from "../lib/population";

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
 * The two populations this table can honestly name, in the words a manager would use — `Stat`
 * builds a sentence around them verbatim ("Top 8% of teams by points for."), so they are noun
 * phrases and the second one carries its own direction. A league is the whole population here:
 * unlike the matchup page, there is nothing wider to compare a team's season against.
 */
const POINTS_FOR_POPULATION = "teams by points for";
const POINTS_AGAINST_POPULATION = "teams by fewest points allowed";

export interface StandingsTableProps {
  readonly rows: readonly TeamStandingsRow[];
  readonly myTeamId: string | null;
  /** Forwarded from `LeagueHome`. Omitted only by tests that don't care about this branch —
   *  `InfoTip` itself defaults to the click-only, non-inline behavior when it's absent. */
  readonly helpLevel?: HelpLevel;
  /**
   * Whether this league plays a median game (`LeagueHomeBody.medianGame`, Task 2). Defaults to
   * `false` — every existing caller that doesn't pass it renders exactly as before: the Record
   * header keeps its plain `standings-record` definition, and no caption note appears. A record
   * already folds the median game's win/loss/tie into the SAME `wins`/`losses`/`ties` a
   * head-to-head result uses (`computeStandings`'s own docblock) — invisible from a row alone —
   * so this table needs the fact stated, not inferred from the numbers it renders.
   */
  readonly medianGame?: boolean;
  /**
   * `LEAGUE_CONFIG.playoffTeams`, threaded down from `LeaguePage` (`src/app/app/(shell)/leagues/
   * [leagueId]/page.tsx`, exempt from the client boundary) rather than value-imported here —
   * `src/league-room/**` may not import `@/league` as a value (`eslint.config.mjs`), and this
   * table has no other way to learn the real cut line. A plain constant threaded as a prop is not
   * new data: no query, no wire field, nothing `read.ts`'s pinned `BASELINE_LEAGUE_HOME_QUERIES`
   * has to grow for. `undefined` (a test that doesn't care) renders no hairline at all — the same
   * "omit the prop, get the old behavior" contract `medianGame` already holds.
   */
  readonly playoffTeams?: number;
}

/** The team just OUTSIDE the playoff field, by real standings rank — never by whatever column
 *  the reader currently has the table sorted on. `rows` is the ORIGINAL, server-ranked array
 *  (never `ordered`, which a Points For/Against sort can reshuffle), so the hairline marks the
 *  same boundary regardless of which column is currently driving the visible order. `undefined`
 *  `playoffTeams`, or a field as large as the league itself (the same degenerate case
 *  `showClinchBadges` already guards), draws nothing. */
function firstTeamOutId(rows: readonly TeamStandingsRow[], playoffTeams: number | undefined): string | null {
  if (playoffTeams === undefined || playoffTeams >= rows.length) return null;
  return rows[playoffTeams]?.teamId ?? null;
}

export function StandingsTable({ rows, myTeamId, helpLevel, medianGame = false, playoffTeams }: StandingsTableProps) {
  const [sort, setSort] = useState<SortKey>("rank");
  const ordered = useMemo(() => [...rows].sort((a, b) => ORDER_BY[sort](b) - ORDER_BY[sort](a)), [rows, sort]);

  // `clinchedTeamIds` reports every team clinched from week 1 whenever the playoff field is at
  // least as big as the league (`playoffTeams >= teamCount`) — a real branch, but a signal with
  // no information in it. Twelve meaningless badges are worse than none, so a whole-league
  // clinch is treated as "nothing to show" rather than rendered literally.
  const showClinchBadges = rows.length > 0 && rows.some((row) => !row.clinched);
  const firstOutId = firstTeamOutId(rows, playoffTeams);

  // The heat map's two populations (the fun pass, Task 10). Read off `rows` — the whole league,
  // in the server's own ranking — never off `ordered`: a re-sort reshuffles what the reader sees
  // and changes nothing about where a number stands among its peers, and a percentile that moved
  // when you pressed "Sort by points against" would be telling you about the sort, not the season.
  const pointsFor = useMemo(() => rows.map((row) => row.pointsFor), [rows]);
  const pointsAgainst = useMemo(() => rows.map((row) => row.pointsAgainst), [rows]);

  const sortable = (key: SortKey, label: string) => (
    <button type="button" className="underline" onClick={() => setSort(key)}>
      {`Sort by ${label}`}
    </button>
  );

  const columns: readonly TableColumn<TeamStandingsRow>[] = [
    {
      key: "team",
      header: "Team",
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2">
          <Avatar name={row.ownerDisplayName} avatar={row.ownerAvatar} size="sm" />
          <span className="truncate">{row.teamName}</span>
          {showClinchBadges && row.clinched ? <Badge tone="positive">Clinched</Badge> : null}
        </span>
      ),
    },
    {
      key: "record",
      header: (
        <span className="inline-flex items-center gap-1">
          Record
          {/* A median league's record is a two-games-a-week one — the definition changes to
              say so, rather than sitting a second icon beside the first for the same header.
              Two literal branches, never a dynamic `term={medianGame ? … : …}` expression:
              `glossary.source.test.ts`'s wiring scan is a static regex over `term="…"` string
              literals, so a computed prop value renders correctly but reads as unwired (A15). */}
          {medianGame ? <InfoTip term="median-game" helpLevel={helpLevel} /> : <InfoTip term="standings-record" helpLevel={helpLevel} />}
        </span>
      ),
      cell: (row) => <span className="font-mono">{formatRecord(row)}</span>,
    },
    // THE HEAT MAP (the fun pass, Task 10). The two columns a reader cannot get from the row
    // order — the record above is what the table is sorted BY, so tinting it would spend the heat
    // on a fact position already tells, which is the "louder without making a true thing more
    // legible" failure rule 6 rejects.
    //
    // `srOnlyLabel`: the `<th>` is the column's label, on screen and announced, and a caption
    // under each of twelve numbers would be the document grammar this pass exists to undo.
    // `items-end` aligns the `Stat`'s flex column inside a `numeric` (right-aligned) cell.
    // Tabular alignment survives the change — `Stat` carries `tabular-nums` on the display face
    // where these cells used to carry `font-mono` (which is tabular by construction, see
    // `docs/design-system.md`'s "Type" section), so a re-sort still never shifts digits sideways.
    {
      key: "pointsFor",
      header: "Points for",
      cell: (row) => (
        <Stat
          label="Points for"
          srOnlyLabel
          size="sm"
          value={formatPoints(row.pointsFor)}
          comparison={comparisonWithin(pointsFor, row.pointsFor, POINTS_FOR_POPULATION)}
          className="items-end"
        />
      ),
      numeric: true,
    },
    {
      key: "pointsAgainst",
      header: "Points against",
      // The one column in this product where the biggest number is the worst one. The population
      // is NAMED in the direction the ramp reads ("teams by fewest points allowed") because
      // `Stat` speaks it out loud — "Top 8% of teams by points against" would be a true tint
      // under a false sentence.
      cell: (row) => (
        <Stat
          label="Points against"
          srOnlyLabel
          size="sm"
          value={formatPoints(row.pointsAgainst)}
          comparison={comparisonWithin(pointsAgainst, row.pointsAgainst, POINTS_AGAINST_POPULATION, "lower-is-better")}
          className="items-end"
        />
      ),
      numeric: true,
      hideOnNarrow: true,
    },
  ];

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3 text-sm text-text-muted">
        {sortable("rank", "standing")}
        {sortable("pointsFor", "points for")}
        {sortable("pointsAgainst", "points against")}
      </div>
      {/* No explicit `density`: `Table` defaults to `"dense"` itself since Task 12 Step 3c's
          closeout (`table.tsx`'s own DENSITY-DEFAULT DECISION docblock). */}
      <Table
        caption="League standings"
        captionVisible
        columns={columns}
        rows={ordered}
        rowKey={(row) => row.teamId}
        rowClassName={(row) => {
          const own = row.teamId === myTeamId ? "border-l-2 border-l-accent bg-surface-elevated font-medium " : "";
          // The playoff cut: a hairline ABOVE the first team out, never a colored row — a
          // color-only boundary is a WCAG 1.4.1 failure, and `border-t-edge` is a real shape
          // change every reader sees, in either theme, whether or not they perceive color at
          // all (Step 2).
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
