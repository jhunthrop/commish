"use client";

import { useMemo } from "react";
import type { TeamStandingsRow } from "../contract";
import { BigNumber, Button, EmptyState, Manager, Movement, Table, type TableColumn } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { formatPoints, formatRecord } from "../lib/format";



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
/**
 * THE MANAGER'S SECOND LINE: their team, then the two season facts that used to be columns of
 * their own. Assembled as one string so the row has one meta line rather than a run of fragments
 * that each need their own separator rule, and so an absent streak or a leader's own dash simply
 * does not appear instead of printing an empty chip.
 */
function metaLineFor(row: TeamStandingsRow, leader: TeamStandingsRow | undefined, showClinch: boolean): string {
  const back = gamesBack(row, leader);
  return [
    // x-: the sport's own clinch notation, older than every incumbent and read at a glance by
    // anyone who has ever seen a standings page. The footnote below the table spells it out.
    `${showClinch && row.clinched ? "x-" : ""}${row.teamName}`,
    ...(row.streak === null || row.streak === "" ? [] : [row.streak]),
    ...(back === "—" ? [] : [`${back} back`]),
  ].join(" · ");
}

/** Games back of the leader, in the sport's own half-game arithmetic; the leader prints a dash. */
function gamesBack(row: TeamStandingsRow, leader: TeamStandingsRow | undefined): string {
  if (leader === undefined || row.teamId === leader.teamId) return "\u2014";
  const back = (leader.wins - row.wins + (row.losses - leader.losses)) / 2;
  return back <= 0 ? "\u2014" : back % 1 === 0 ? String(back) : back.toFixed(1);
}

export function StandingsTable({ rows, myTeamId, medianGame = false, playoffTeams }: StandingsTableProps) {
  // NO SORT TABS (founder, 2026-08-30: "we have tabs for points for and points against but we
  // already show them"). Both columns are visible on every row — re-ordering a table the eye
  // has already read is chrome doing the reader's job. The server's ranking is the order.
  const ordered = useMemo(() => [...rows], [rows]);

  // `clinchedTeamIds` reports every team clinched from week 1 whenever the playoff field is at
  // least as big as the league (`playoffTeams >= teamCount`) — a real branch, but a signal with
  // no information in it. Twelve meaningless badges are worse than none, so a whole-league
  // clinch is treated as "nothing to show" rather than rendered literally.
  const showClinchBadges = rows.length > 0 && rows.some((row) => !row.clinched);
  const firstOutId = firstTeamOutId(rows, playoffTeams);


  /**
   * FOUR COLUMNS, AND THE OWNER IS ON EVERY ROW (Sideline, 2026-09-10 — `TOKENS.density.
   * maxColumns`). The table carried eight: rank, team, move, record, streak, games back, points
   * for, points against. Eight columns is a spreadsheet, and P1's own rules-out list names the
   * exact failure the second one was committing, *"owner names hidden behind team names"*, with
   * the person reduced to a 28px decoration beside a team.
   *
   * Nothing measured was deleted; three facts changed altitude. The RANK and its MOVEMENT are one
   * cell, because the numeral is where a team sits and the arrow is what happened to them, and a
   * reader takes both in one glance. STREAK and GAMES BACK ride the manager's meta line, which is
   * where a fact about a season belongs when it is not the thing being compared. POINTS AGAINST
   * rides the basis under points for, which is the caption that names what the big number is and
   * therefore the honest place for the number it is weighed against.
   */
  const columns: readonly TableColumn<TeamStandingsRow>[] = [
    {
      // THE POSITION NUMERAL AND ITS MOVEMENT, in one cell. `row.rank` and never the render index:
      // a seed is a fact about the season, and the visible order is a reading aid. `aria-hidden`
      // on the numeral because the row already announces its manager, and a bare "3" spoken before
      // a name is noise; the movement beside it carries the spoken sentence for both.
      // `previousRank - rank` because a SMALLER number is a better place. `null` is a league with
      // nothing behind it, and `Movement` is not rendered at all, because a zero would read as
      // "unchanged", which is a claim.
      key: "rank",
      header: "#",
      cell: (row) => (
        <span className="flex flex-col items-start gap-0.5">
          <span
            aria-hidden="true"
            className={`font-display text-xl font-extrabold leading-none tabular-nums ${
              row.teamId === myTeamId ? "text-self-ink" : "text-text-faint"
            }`}
          >
            {row.rank}
          </span>
          {row.previousRank === null ? (
            <span className="font-display text-xs text-text-faint">
              <span aria-hidden="true">{"—"}</span>
              <span className="sr-only">No ranking from {MOVEMENT_AGAINST} to compare against</span>
            </span>
          ) : (
            <Movement places={row.previousRank - row.rank} against={MOVEMENT_AGAINST} />
          )}
        </span>
      ),
    },
    {
      // THE PERSON, THEN THE TEAM (P1). `Manager` is the only way a face reaches a Sideline row and
      // it carries the name with it, so an owner can never be a decoration beside a team name
      // again. The clinch, the streak and the games back are the meta line under the name.
      key: "team",
      header: "Manager",
      cell: (row) => (
        <Manager
          name={row.ownerDisplayName}
          avatar={row.ownerAvatar}
          size="md"
          ring={row.teamId === myTeamId ? "self" : undefined}
          meta={metaLineFor(row, rows[0], showClinchBadges)}
        />
      ),
    },
    {
      // "W-L-T" reads as itself. See this component's docblock for the tip that used to sit here.
      key: "record",
      header: "W-L-T",
      cell: (row) => <span className="font-display text-base font-bold tabular-nums text-text-primary">{formatRecord(row)}</span>,
      numeric: true,
    },
    // PLAIN, ON PURPOSE (the persona pass, 2026-08-30 — the veteran: "two different arrow
    // systems in adjacent columns", "a 2% spread painted like a blowout"). A standings page has a
    // settled grammar older than the web: plain tabular numbers, and the reader's own eye down the
    // sorted column. The heat lives where a comparison is the question, not where the sort order
    // already answered it. What IS new is that the number states its basis (P2), and the basis is
    // where points against now lives.
    {
      key: "pointsFor",
      header: "Points for",
      cell: (row) => <BigNumber value={formatPoints(row.pointsFor)} basis={`for, ${formatPoints(row.pointsAgainst)} against`} size="sm" />,
      numeric: true,
    },
  ];

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-display-sm font-semibold leading-display text-text-primary">Standings</h2>
      <Table
        fill
        caption="League standings"
        columns={columns}
        rows={ordered}
        rowKey={(row) => row.teamId}
        rowClassName={(row) => {
          // YOUR ROW IS AMBER, NOT BLUE (Sideline's fourth chroma, `tokens.ts`). Through v5 the
          // rail was `accent`, which in Sideline is Court blue and means "press this" — a whole
          // row washed in the verb's own pigment on a page with no verb in it. Amber is "yours"
          // and nothing else, so the wash is `self-wash` and the rail is `border-l-self`. One row
          // of twelve, found at a glance, with no promise of a control attached.
          const own = row.teamId === myTeamId ? "self-wash border-l-[3px] border-l-self " : "";
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
      {/* THE PLAYOFF PICTURE (the tab loop, 2026-08-30): the bracket the CURRENT standings
          imply, said honestly — "if the season ended today" is a real derivation of real
          results, the exact panel every incumbent's standings page runs. Byes for the top two,
          3v6 and 4v5, the shipped bracket's own shape. Hidden when the field is smaller than
          the cut — nothing to bracket. */}
      {rows.length > 6 ? (
        <section aria-label="Playoff picture" className="flex flex-col gap-2 border-t border-line pt-4">
          <div className="flex items-baseline gap-3">
            <h3 className="font-display text-lg font-bold text-text-primary">Playoff picture</h3>
            <span className="text-sm text-text-faint">if the season ended today</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5 rounded-md bg-surface-elevated px-3 py-2.5">
              <span className={`${MICRO_LABEL} text-text-faint`}>First-round byes</span>
              {[rows[0], rows[1]].map((row, index) =>
                row === undefined ? null : (
                  <span key={row.teamId} className="flex items-baseline gap-2 text-base text-text-primary">
                    <span className="font-display font-bold tabular-nums text-text-muted">{index + 1}</span>
                    <span className="truncate">{row.teamName}</span>
                  </span>
                ),
              )}
            </div>
            {[
              { label: "3 vs 6", pair: [rows[2], rows[5]] as const, seeds: [3, 6] as const },
              { label: "4 vs 5", pair: [rows[3], rows[4]] as const, seeds: [4, 5] as const },
            ].map((game) => (
              <div key={game.label} className="flex flex-col gap-1.5 rounded-md bg-surface-elevated px-3 py-2.5">
                <span className={`${MICRO_LABEL} text-text-faint`}>{game.label}</span>
                {game.pair.map((row, index) =>
                  row === undefined ? null : (
                    <span key={row.teamId} className="flex items-baseline gap-2 text-base text-text-primary">
                      <span className="font-display font-bold tabular-nums text-text-muted">{game.seeds[index]}</span>
                      <span className="truncate">{row.teamName}</span>
                    </span>
                  ),
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {rows.length === 0 ? null : (
        // The rule the server ranks by, said out loud: nobody should have to guess how a
        // 7-7 logjam resolves. (Persona review: veterans want the tiebreak named.)
        <p className="text-xs text-text-muted">
          Ties in the standings break on points for.
          {firstOutId !== null ? " The heavy line is the playoff cut." : ""}
          {showClinchBadges ? " x- means a clinched playoff spot." : ""}
          {medianGame ? " Records include each week's median game." : ""}
        </p>
      )}
    </section>
  );
}
