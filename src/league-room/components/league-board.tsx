import Link from "next/link";
import type { HomeLeagueCard } from "../contract";
import { Crest, EYEBROW, Meter, Table, type TableColumn } from "@/components/ui";
import { actionHref } from "../lib/action-href";
import { formatPoints, formatRecord, formatWeek } from "../lib/format";
import { WeekStatusBadge } from "./week-status-badge";

/** The needs-you set the board sorts to the top — the SAME two kinds the rail's own `stateFor`
 *  (`@/components/app-shell/shell-data`) treats as needs-you (F1). */
function needsYou(league: HomeLeagueCard): boolean {
  const kind = league.nextAction?.kind;
  return kind === "fix-lineup" || kind === "join-draft";
}

/** How close the game is, as a plain subtraction — `Infinity` for a league with no live score
 *  to measure yet, so it sorts after every game that actually has a margin. */
function marginOf(league: HomeLeagueCard): number {
  const matchup = league.matchup;
  if (matchup === null || matchup.homeScore === null || matchup.awayScore === null) return Number.POSITIVE_INFINITY;
  return Math.abs(matchup.homeScore - matchup.awayScore);
}

/** Sorted by whether the manager is needed, then by how close the game is (Step 2) — a
 *  subtraction this product can actually do, never a model's probability. */
function sortLeagues(leagues: readonly HomeLeagueCard[]): readonly HomeLeagueCard[] {
  return [...leagues].sort((a, b) => {
    const need = Number(needsYou(b)) - Number(needsYou(a));
    if (need !== 0) return need;
    return marginOf(a) - marginOf(b);
  });
}

/** "+4.52" for the manager's own team leading, "-4.52" trailing — a plain, signed subtraction,
 *  never a probability (D1 defers the model this would need). `null` when there is no live
 *  score to measure a margin from at all. */
function myMargin(league: HomeLeagueCard): number | null {
  const matchup = league.matchup;
  if (matchup === null || matchup.homeScore === null || matchup.awayScore === null) return null;
  const mine = matchup.homeTeamId === league.myTeamId ? matchup.homeScore : matchup.awayScore;
  const theirs = matchup.homeTeamId === league.myTeamId ? matchup.awayScore : matchup.homeScore;
  return mine - theirs;
}

function formatMargin(margin: number): string {
  return `${margin >= 0 ? "+" : ""}${margin.toFixed(2)}`;
}

/** The matchup cell: the two scores, the leader's name carrying full ink — the SAME leader
 *  convention `MatchupScoreboard` uses — plus, for a median league, the SECOND result as a
 *  median line rather than the mock's own reused head-to-head vs-block (locker-room-panel.md,
 *  MEDIUM: that reused block read as a team called LEAGUE MEDIAN at a glance). */
function MatchupCell({ league }: { readonly league: HomeLeagueCard }) {
  const matchup = league.matchup;
  if (matchup === null) {
    return <p className="text-sm text-text-muted">{`${formatWeek(league.weekNumber)}: no matchup.`}</p>;
  }
  const homeLeads = matchup.homeScore !== null && matchup.awayScore !== null && matchup.homeScore > matchup.awayScore;
  const awayLeads = matchup.homeScore !== null && matchup.awayScore !== null && matchup.awayScore > matchup.homeScore;
  const side = (name: string, score: number | null, leads: boolean) => (
    <span className={leads ? "font-semibold text-text-primary" : "text-text-muted"}>
      {name} {score === null ? "Not yet scored" : formatPoints(score)}
    </span>
  );
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-1 text-sm">
        {side(matchup.homeTeamName, matchup.homeScore, homeLeads)}
        <span aria-hidden="true" className="text-text-muted">
          vs
        </span>
        {side(matchup.awayTeamName, matchup.awayScore, awayLeads)}
      </div>
      {league.medianGame && league.medianScore !== null ? (
        <p className="text-xs text-text-muted">{`League median ${league.medianScore}`}</p>
      ) : null}
    </div>
  );
}

/** The margin `Meter` (Step 2): its label IS the signed subtraction ("+4.52"), never a
 *  probability, and its value/max is this manager's own share of the combined score — the bar
 *  is the glance, the label is the decision (`Meter`'s own contract). `null` when there is no
 *  live score to measure a margin from at all (a bye, or a week that has not started). */
function MarginCell({ league }: { readonly league: HomeLeagueCard }) {
  const margin = myMargin(league);
  if (margin === null) return <span className="text-sm text-text-muted">No score yet</span>;
  const matchup = league.matchup!;
  const mine = matchup.homeTeamId === league.myTeamId ? matchup.homeScore! : matchup.awayScore!;
  const combined = matchup.homeScore! + matchup.awayScore!;
  return <Meter label={formatMargin(margin)} value={mine} max={combined <= 0 ? 1 : combined} className="min-w-[8rem]" />;
}

function LeagueCell({ league }: { readonly league: HomeLeagueCard }) {
  return (
    <div className="flex items-center gap-2">
      <Crest id={league.id} label={league.name.slice(0, 2).toUpperCase()} size={32} />
      <div className="flex min-w-0 flex-col">
        <Link href={`/app/leagues/${league.id}`} className="min-w-0 truncate font-medium text-text-primary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          {league.name}
        </Link>
        {league.record === null ? null : (
          // D5: a record may carry ONE step of extra type-scale weight and nothing else — no
          // color, no badge, no animation, no second row.
          <span className="text-base font-semibold tabular-nums text-text-primary">{formatRecord(league.record)}</span>
        )}
      </div>
    </div>
  );
}

function ActionCell({ league }: { readonly league: HomeLeagueCard }) {
  if (league.nextAction === null) return null;
  return (
    <Link
      href={actionHref(league)}
      aria-label={`${league.nextAction.label} for ${league.name}`}
      className="inline-flex rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-text transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      {league.nextAction.label}
    </Link>
  );
}

// Persona panel, Step 5 (the phone user): the score and the state badge stay INTACT at 360px —
// only `margin` (supplementary detail, already restated by the matchup cell's own leader mark)
// drops below `sm`. `WeekStatusBadge` never hides.
const COLUMNS: readonly TableColumn<HomeLeagueCard>[] = [
  { key: "league", header: "League", cell: (league) => <LeagueCell league={league} /> },
  { key: "matchup", header: "Matchup", cell: (league) => <MatchupCell league={league} /> },
  { key: "margin", header: "Margin", cell: (league) => <MarginCell league={league} />, hideOnNarrow: true },
  { key: "action", header: "Action", cell: (league) => <ActionCell league={league} /> },
  { key: "state", header: "State", cell: (league) => <WeekStatusBadge status={league.weekStatus} /> },
];

export interface LeagueBoardProps {
  readonly leagues: readonly HomeLeagueCard[];
}

/**
 * The multi-league board (Phase 3.6, Task 10, Step 2): crest, league name with its record and
 * this week's matchup, the margin, the one next action, and the week's own state — every column
 * a fact this product actually holds. The mock's win-probability column, moments column and
 * season projection are NOT rendered (deferrals D1, D2, D3 name the data each would require);
 * the action column replaces them, and it is real, already computed by `nextActionFor`.
 *
 * Sorted by whether the manager is needed, then by margin — never a probability. `Table` now
 * defaults to `density="dense"` itself (Task 12 Step 3c's closeout, once every consumer in the
 * product wanted it), so this page no longer opts in explicitly — see `table.tsx`'s own
 * DENSITY-DEFAULT DECISION docblock.
 */
export function LeagueBoard({ leagues }: LeagueBoardProps) {
  const sorted = sortLeagues(leagues);
  return (
    <Table
      caption="Your leagues"
      columns={COLUMNS}
      rows={sorted}
      rowKey={(league) => league.id}
      empty={<p className={`${EYEBROW} text-text-muted`}>No leagues yet.</p>}
    />
  );
}
