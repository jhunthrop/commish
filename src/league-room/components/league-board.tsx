import Link from "next/link";
import type { HomeLeagueCard } from "../contract";
import { ButtonLink, Crest, EYEBROW, NOT_STARTED_DASH, PointsShareBar, Stat, Table, type TableColumn } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { comparisonWithin } from "../lib/population";
import { actionHref } from "../lib/action-href";
import { formatPoints, formatRecord, formatWeek } from "../lib/format";
import { WeekStatusBadge } from "./week-status-badge";

/** The crest tile, px. One step under the rail's own 40px tile: the same league reads as the same
 *  object in both places, and law 3 says a league IS an object — a 32px chip was a bullet point. */
const CREST_SIZE_PX = 36;

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
 *  subtraction this product can actually do, never a model's probability. Exported for
 *  `AttentionQueue` (LED-1): the queue's own "the rest by the board's own order" tier reuses
 *  THIS function rather than re-deriving a second copy of the board's sort — the two can never
 *  quietly disagree about what "the board's own order" means. */
export function sortLeagues(leagues: readonly HomeLeagueCard[]): readonly HomeLeagueCard[] {
  return [...leagues].sort((a, b) => {
    const need = Number(needsYou(b)) - Number(needsYou(a));
    if (need !== 0) return need;
    return marginOf(a) - marginOf(b);
  });
}

/**
 * This manager's end of a matchup and the opponent's, resolved ONCE per row.
 *
 * Every cell on the row used to re-derive `homeTeamId === myTeamId` for itself, which is how the
 * matchup cell ended up printing home-then-away (the league's order) while the margin cell printed
 * mine-then-theirs (the manager's order) — two orders for one fact, on one row. A board this
 * screen is the daily landing for has exactly one point of view: the manager's.
 */
interface Sides {
  readonly mineName: string;
  readonly mineScore: number | null;
  readonly theirsName: string;
  readonly theirsScore: number | null;
}

function sidesOf(league: HomeLeagueCard): Sides | null {
  const matchup = league.matchup;
  if (matchup === null) return null;
  const iAmHome = matchup.homeTeamId === league.myTeamId;
  return {
    mineName: iAmHome ? matchup.homeTeamName : matchup.awayTeamName,
    mineScore: iAmHome ? matchup.homeScore : matchup.awayScore,
    theirsName: iAmHome ? matchup.awayTeamName : matchup.homeTeamName,
    theirsScore: iAmHome ? matchup.awayScore : matchup.homeScore,
  };
}

/** "+4.52" for the manager's own team leading, "-4.52" trailing — a plain, signed subtraction,
 *  never a probability (D1 defers the model this would need). `null` when there is no live
 *  score to measure a margin from at all. */
function myMargin(league: HomeLeagueCard): number | null {
  const sides = sidesOf(league);
  if (sides === null || sides.mineScore === null || sides.theirsScore === null) return null;
  return sides.mineScore - sides.theirsScore;
}

function formatMargin(margin: number): string {
  return `${margin >= 0 ? "+" : ""}${margin.toFixed(2)}`;
}

/**
 * A score, drawn the way a scoreboard draws one (law 2): the figure over its own micro-label,
 * tabular, in the display face. `null` is the DASH, never a zero — "has not played" and "played
 * and scored nothing" are different facts, and folding the first into the second is the lie
 * `NOT_STARTED_DASH` exists to stop ("A player who has not played reads as a dash", the Gameday
 * spec's own words, applied to a team total for the same reason).
 *
 * `leading` is the only ink this component spends, and it is deliberately NOT magnitude colour:
 * the population a head-to-head has to hand is a PAIR, and a percentile inside a set of two is
 * fully determined by who is ahead — see `Scoreboard`'s own refusal, which this follows verbatim.
 * Being ahead is carried by the size of the figure and by full ink, which a monochrome eye reads.
 */
function Score({ label, points, size, leading }: { readonly label: string; readonly points: number | null; readonly size: string; readonly leading: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className={`font-display leading-display tabular-nums ${size} ${leading ? "font-semibold text-text-primary" : "text-text-muted"}`}
      >
        {points === null ? NOT_STARTED_DASH : formatPoints(points)}
      </span>
      <span className={`${MICRO_LABEL} block max-w-36 truncate text-text-faint`}>{label}</span>
    </div>
  );
}

/** The manager's own score — the loudest thing on its row, which is what law 2 asks a board for.
 *  Below `sm` it also carries the opponent's line, because the opponent column is dropped there
 *  and a score with nothing to beat is not a matchup. */
function MyScoreCell({ league }: { readonly league: HomeLeagueCard }) {
  const sides = sidesOf(league);
  if (sides === null) {
    return <span className="text-sm text-text-muted">No matchup</span>;
  }
  const leads = sides.mineScore !== null && sides.theirsScore !== null && sides.mineScore > sides.theirsScore;
  return (
    <div className="flex flex-col gap-1">
      <Score label={sides.mineName} points={sides.mineScore} size="text-display-md" leading={leads} />
      <p className="text-xs text-text-muted sm:hidden">
        {`vs ${sides.theirsName} ${sides.theirsScore === null ? NOT_STARTED_DASH : formatPoints(sides.theirsScore)}`}
      </p>
    </div>
  );
}

/** The opponent, one step down the display scale — the same pairing, quieter, so the eye reads
 *  the row in the order the manager cares about. A median league's second result rides here
 *  rather than in the mock's reused vs-block, which read as a team called LEAGUE MEDIAN at a
 *  glance (locker-room-panel.md, MEDIUM). */
function OpponentCell({ league }: { readonly league: HomeLeagueCard }) {
  const sides = sidesOf(league);
  if (sides === null) return null;
  const leads = sides.mineScore !== null && sides.theirsScore !== null && sides.theirsScore > sides.mineScore;
  return (
    <div className="flex flex-col gap-1">
      <Score label={sides.theirsName} points={sides.theirsScore} size="text-display-sm" leading={leads} />
      {league.medianGame && league.medianScore !== null ? (
        <p className="text-xs text-text-muted">{`League median ${league.medianScore}`}</p>
      ) : null}
    </div>
  );
}

/**
 * The margin, and how close it is.
 *
 * THE ONE NUMBER THIS ROW IS ABOUT (the fun pass, 2026-08-28). The population is THIS BOARD'S own
 * margins: the leagues you are playing this week, which is the only pool the page actually holds
 * and the one a manager compares in their head anyway ("I am getting beaten worse here than
 * there"). It refuses below `heatMinPopulation`, so a manager in two leagues gets plain ink rather
 * than a percentile across two numbers, which would be arithmetic dressed as a fact.
 *
 * The bar beneath it is `PointsShareBar`, not `Meter`: it answers the different question ("how
 * close", against a named opponent) and it names both sides, so the row no longer needs a "Share
 * of points" caption restating the label of the number directly above it. Its docblock is also the
 * one place that says out loud what the bar is NOT — a win probability this product cannot
 * compute.
 */
function MarginCell({ league, margins }: { readonly league: HomeLeagueCard; readonly margins: readonly number[] }) {
  const margin = myMargin(league);
  const sides = sidesOf(league);
  if (margin === null || sides === null || sides.mineScore === null || sides.theirsScore === null) {
    return <span className="text-sm text-text-muted">No score yet</span>;
  }
  return (
    <div className="flex min-w-40 flex-col gap-1.5">
      <Stat label="Margin" srOnlyLabel value={formatMargin(margin)} comparison={comparisonWithin(margins, margin, "your leagues this week")} />
      <PointsShareBar mineLabel="You" theirsLabel={sides.theirsName} mine={sides.mineScore} theirs={sides.theirsScore} />
    </div>
  );
}

/** The league as an object (law 3): its crest, its name, and the record beneath — mono and
 *  tabular now, so seven records line up as a column a manager can read down rather than seven
 *  independently-set strings. D5 still holds: a record may carry ONE step of extra type scale and
 *  a weight step, and nothing else — no color, no badge, no animation. */
function LeagueCell({ league }: { readonly league: HomeLeagueCard }) {
  return (
    <div className="flex items-center gap-2.5">
      <Crest id={league.id} name={league.name} size={CREST_SIZE_PX} />
      <div className="flex min-w-0 flex-col">
        <Link
          href={`/app/leagues/${league.id}`}
          className="min-w-0 truncate font-display text-base font-medium text-text-primary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {league.name}
        </Link>
        {league.record === null ? null : (
          <span className="font-mono text-base font-semibold tabular-nums text-text-primary">{formatRecord(league.record)}</span>
        )}
      </div>
    </div>
  );
}

/**
 * LAW 5, THE VERB IS OBVIOUS. This used to be a quiet pill, on the reasoning that "ten rows must
 * never mean ten ink pills" — and that reasoning was v3 rule 5, which Gameday reverses by name:
 * *"the action a screen exists for is the loudest thing on it, however many times it repeats"*,
 * and *"a board of forty rows cannot spend its one ink pill on row one and leave thirty-nine quiet
 * outlines behind it"*. This board is the leagues index: setting a lineup and joining a draft is
 * the entire reason a manager opened it, and every row offered the same act in the same whisper.
 *
 * `verb`, not `primary`: money-filled and `rounded-md`, which is the variant Gameday added for
 * exactly this and which `page-audit.spec.ts` correctly does not count as ink — the ceremonial ink
 * pill stays available, unspent, for a surface that genuinely does one thing once.
 */
function ActionCell({ league }: { readonly league: HomeLeagueCard }) {
  if (league.nextAction === null) return null;
  return (
    <ButtonLink href={actionHref(league)} aria-label={`${league.nextAction.label} for ${league.name}`} variant="verb" size="sm">
      {league.nextAction.label}
    </ButtonLink>
  );
}

/**
 * The week's own state, and WHICH week it is — the fact the board carried in its data and never
 * printed, so a manager reading seven rows had to take on faith they were all the same week.
 *
 * The per-row week renders ONLY when the board disagrees with itself. Seven identical "Week 14"
 * labels down a column is the draft board's refused tally in another costume (`docs/design-system
 * .md`: *"48 mono digits at 12-team density read as texture, not information"*) — law 4 asks for
 * more true facts per screen, and the same fact restated seven times is not seven facts. When
 * every league agrees, the week is stated once, in the score column's own head.
 */
function StateCell({ league, sharedWeek }: { readonly league: HomeLeagueCard; readonly sharedWeek: number | null }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <WeekStatusBadge status={league.weekStatus} />
      {sharedWeek === null ? <span className={`${MICRO_LABEL} text-text-faint`}>{formatWeek(league.weekNumber)}</span> : null}
    </div>
  );
}

/** The one week every league on this board is playing, or `null` when they disagree. */
function sharedWeekOf(leagues: readonly HomeLeagueCard[]): number | null {
  const first = leagues[0];
  if (first === undefined) return null;
  return leagues.every((league) => league.weekNumber === first.weekNumber) ? first.weekNumber : null;
}

/** A column header, in the one register the caps charter sanctions for a shouted key beside data
 *  (`MICRO_LABEL`). A scoreboard has always set its column heads this way, and `Table`'s own
 *  default — sentence case, body face — is what made this board read as a spreadsheet of prose. */
function Head({ children }: { readonly children: string }) {
  return <span className={`${MICRO_LABEL} text-text-faint`}>{children}</span>;
}

// Persona panel, Step 5 (the phone user): the score, the state badge and the verb stay INTACT at
// 360px. `opponent` and `margin` drop below `sm` — the opponent's line is restated inside the
// score cell there (`MyScoreCell`), so nothing true leaves with the column.
function columnsFor(margins: readonly number[], sharedWeek: number | null): readonly TableColumn<HomeLeagueCard>[] {
  return [
    { key: "league", header: <Head>League</Head>, cell: (league) => <LeagueCell league={league} /> },
    {
      key: "mine",
      header: <Head>{sharedWeek === null ? "Your score" : `Your score · ${formatWeek(sharedWeek)}`}</Head>,
      cell: (league) => <MyScoreCell league={league} />,
    },
    { key: "opponent", header: <Head>Opponent</Head>, cell: (league) => <OpponentCell league={league} />, hideOnNarrow: true },
    { key: "margin", header: <Head>Margin</Head>, cell: (league) => <MarginCell league={league} margins={margins} />, hideOnNarrow: true },
    { key: "state", header: <Head>State</Head>, cell: (league) => <StateCell league={league} sharedWeek={sharedWeek} /> },
    { key: "action", header: <Head>Action</Head>, cell: (league) => <ActionCell league={league} /> },
  ];
}

export interface LeagueBoardProps {
  readonly leagues: readonly HomeLeagueCard[];
}

/**
 * The multi-league board — the screen a signed-in manager actually lands on.
 *
 * GAMEDAY (2026-08-28). The founder's verdict on the previous pass was a screenshot of THIS page
 * with the words "I don't see any changes", and the board is why: every fact on it was true and
 * every one of them was set at 13px inside a sentence. The scores lived in the middle of "Dev
 * Manager 04 15.00 vs Commish Lab's team 10.00", the largest thing on the screen was the page
 * title, and the one act the page exists for repeated seven times in a whisper. Four laws, spent:
 *
 * - **Law 2.** The manager's own score is the row's hero at `display-md` over an 11px micro-label,
 *   and the opponent's sits one step down at `display-sm`. The scores now stack into columns that
 *   line up down the board instead of floating at different offsets inside seven sentences.
 * - **Law 1.** Unchanged where it was already right (the margin's magnitude ramp against a stated
 *   population, `WeekStatusBadge`'s live red) and not extended to the score, for the reason
 *   `Scoreboard` states: a pair is not a population.
 * - **Law 4.** Mono micro-label column heads, the week printed rather than assumed, and the
 *   margin's redundant "Share of points" caption replaced by a bar that names both sides.
 * - **Law 5.** The action is the money-filled `verb`, on every row that has one.
 *
 * Sorted by whether the manager is needed, then by margin — never a probability. The mock's
 * win-probability, moments and season-projection columns are still NOT rendered (deferrals D1, D2,
 * D3 name the data each would require).
 */
export function LeagueBoard({ leagues }: LeagueBoardProps) {
  const sorted = sortLeagues(leagues);
  // Built from every league that HAS a live margin — a league on a bye contributes no number, and
  // padding the pool with a zero would tell a manager they are mid-table when they are not playing.
  const margins = sorted.map(myMargin).filter((margin): margin is number => margin !== null);
  return (
    <Table
      caption="Your leagues"
      columns={columnsFor(margins, sharedWeekOf(sorted))}
      rows={sorted}
      rowKey={(league) => league.id}
      empty={<p className={`${EYEBROW} text-text-muted`}>No leagues yet.</p>}
    />
  );
}
