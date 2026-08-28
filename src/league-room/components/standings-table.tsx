"use client";

import { useMemo, useState } from "react";
import type { TeamStandingsRow } from "../contract";
import { Avatar, Badge, Button, EmptyState, InfoTip, Table, type TableColumn } from "@/components/ui";
import type { HelpLevel } from "@/identity/preferences";
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
 * states it out loud ("lower is better") rather than smuggling it into the phrase — points against
 * used to be named "teams by fewest points allowed", which was a true sentence doing a job the
 * column head can do in three words.
 */
const LEAGUE_POPULATION = "the league";

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

  // The two population arrays this component used to memoise are gone: `Table` builds a judged
  // column's set from the rows it is handed. A re-sort cannot move a percentile, because a
  // percentile is order-independent and `ordered` holds the same twelve numbers `rows` does —
  // which is the property the old comment was defending by hand.

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
          {/* `normal-case` because a guided reader's `InfoTip` renders its whole caption inline
              inside this header, and `Table`'s heads are now the caps charter's micro-label
              register — without this, "Wins, losses, and ties so far this season." would arrive
              shouted. The LABEL beside it still takes the register; only the sentence opts out,
              which is the charter's own line: caps in a micro-label, sentence case in prose. */}
          <span className="normal-case tracking-normal">
            {medianGame ? <InfoTip term="median-game" helpLevel={helpLevel} /> : <InfoTip term="standings-record" helpLevel={helpLevel} />}
          </span>
        </span>
      ),
      cell: (row) => <span className="font-mono">{formatRecord(row)}</span>,
    },
    // THE HEAT MAP (the fun pass, Task 10; declarative since 2026-08-28). The two columns a reader
    // cannot get from the row order — the record above is what the table is sorted BY, so tinting
    // it would spend the heat on a fact position already tells, which is the "louder without
    // making a true thing more legible" failure rule 6 rejects.
    //
    // `judged` rather than a hand-built `Stat` per cell: the comparison set is the column, `Table`
    // builds it once from the rows it was handed, and the head prints what it is. Twenty-two lines
    // of per-cell wiring — the label, the `srOnlyLabel`, the `items-end`, the two memoised
    // population arrays — became these six, and the two columns can no longer drift apart.
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
      <div className="flex flex-wrap gap-3 text-sm text-text-muted">
        {sortable("rank", "standing")}
        {sortable("pointsFor", "points for")}
        {sortable("pointsAgainst", "points against")}
      </div>
      {/* No explicit `density`: `Table` defaults to `"dense"` itself since Task 12 Step 3c's
          closeout (`table.tsx`'s own DENSITY-DEFAULT DECISION docblock). */}
      {/* The caption is the table's accessible name and nothing more (2026-08-28). It used to
          print "League standings" above a standings table that sits under a league's own name, on
          a league's own page, beside three controls that all say "Sort by …" — a label restating
          what the reader is already looking at. The two judged column heads now state the only
          fact the caption was carrying that the page did not. */}
      <Table
        caption="League standings"
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
