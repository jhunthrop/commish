import type { ReactNode } from "react";
import type { TeamCard } from "@/domain/league";
import type { Player } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import { EYEBROW, LowerThird, PlayerFace, PositionBadge, type LowerThirdCell } from "@/components/ui";
import { BENCH_SLOT } from "@/domain/roster";
import { playersById as buildPlayersById } from "../lib/lookups";
import { verdictFor, verdictPopulation, type Verdict } from "../lib/verdict";
import { formatPickFactClause, type PickFactCopy } from "../state/format";
import { reviewPicks } from "../state/pick-review";
import { rosterFillRows } from "../state/roster-fill";
import { RosterRow } from "./roster-row";
import { VerdictChip } from "./verdict-chip";

/** Mirrors `MockResultsCopy` (`../contract`) — the wire type this room fetches, forwarded down
 *  as one prop rather than several so `DraftRoom` stays a single pass-through.
 *  `rosterHeading`/`picksHeading`/`openSlotLabel`/`noPicksMessage`/`pickFact` are the mock-
 *  results design review's own finding (E6, 2026-08-26): this surface's remaining bare literals,
 *  moved into `MOCK_COPY` beside their siblings rather than hardcoded here. */
export interface MockResultsCopy {
  readonly heading: string;
  readonly retentionSentence: string;
  readonly rosterHeading: string;
  readonly picksHeading: string;
  readonly openSlotLabel: string;
  readonly noPicksMessage: string;
  readonly pickFact: PickFactCopy;
  readonly runAgainLabel: string;
  readonly openLobbyLabel: string;
  readonly browseLeaguesLabel: string;
}

export interface MockResultsProps {
  readonly view: DraftStateView;
  /** The seats, for the debrief's meta line (results review E5: your seat, the room's shape,
   *  who you played) — data `DraftRoom` always held and never passed down. */
  readonly teams: readonly TeamCard[];
  /** The room's own finished board (results review R3): `DraftRoom` builds the `DraftBoard` it
   *  was already rendering ninety seconds earlier and hands it down — the single strongest
   *  image the product makes, kept at the exact moment it is finally complete. */
  readonly board: ReactNode;
  /** In the same ranked order `START_DRAFT` snapshots — `GET /api/drafts/[draftId]/players`'s
   *  own docblock — which is what makes the board delta below a fact of THIS draft's own log
   *  rather than a live, still-moving ranking. */
  readonly players: readonly Player[];
  /** Null for a commissioner watching a mock without a team of their own — the roster and pick
   *  list below have nothing to say for that caller, so this component says only the heading,
   *  the retention line and the three next actions. */
  readonly myTeamId: string | null;
  readonly copy: MockResultsCopy;
  /**
   * The room's own way out (Step 2: "never a dead end") — real navigations, built by `DraftRoom`
   * so this component stays presentational, the same `primaryAction`/`secondaryAction` shape
   * `SeatTakenPanel` (`@/league-room/components/seat-taken-panel`) already uses for the same
   * reason: a results panel has no business owning routes.
   */
  readonly actions: {
    readonly runAgain: ReactNode;
    readonly openLobby: ReactNode;
    readonly browseLeagues: ReactNode;
  };
}

/**
 * One row per roster spot, in `view.slotConfig`'s own order (QB, then RB, then …) — never one
 * row per slot TYPE with several names crammed onto it, so "who is at my second RB spot" is a
 * fact this list states plainly rather than something a reader parses out of a comma list.
 */
function RosterSection({
  view,
  playersById,
  myTeamId,
  copy,
}: {
  readonly view: DraftStateView;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTeamId: string;
  readonly copy: MockResultsCopy;
}) {
  // THE SAME ROW the rail draws (results review D1/D2): faces, the player's OWN position, the
  // bench under its hairline — the finisher's team rendered exactly as well as the room
  // rendered it a minute earlier, because it is literally the same component.
  const rows = rosterFillRows(view.slotConfig, view.rosters[myTeamId] ?? []);
  const firstBenchIndex = rows.findIndex((row) => row.slot === BENCH_SLOT);
  return (
    <div className="flex flex-col gap-2">
      <h2 className={`${EYEBROW} text-text-muted`}>{copy.rosterHeading}</h2>
      <ul aria-label={copy.rosterHeading} className="flex flex-col gap-1.5">
        {rows.map((row, index) => (
          <RosterRow
            key={`${row.slot}:${row.slotIndex}`}
            slot={row.slot}
            player={row.playerId === null ? null : (playersById.get(row.playerId) ?? null)}
            className={index === firstBenchIndex ? "mt-1 border-t border-line pt-2" : undefined}
          />
        ))}
      </ul>
    </div>
  );
}

/** One row of the pick log, paired with the verdict its own board rank earns (Task 7). */
interface JudgedPick {
  readonly review: ReturnType<typeof reviewPicks>[number];
  readonly player: Player;
  readonly verdict: Verdict;
}

/**
 * Every pick the caller made, each carrying the honest facts it always carried AND the verdict
 * those facts add up to. `verdictPopulation` is built once from the whole draft — every seat's
 * picks, not only this manager's — because "was that good?" is a question about the room, and a
 * manager who compared their own picks only to their own picks would be grading on a curve of
 * one.
 */
function judgedPicks(view: DraftStateView, players: readonly Player[], playersById: ReadonlyMap<string, Player>, myTeamId: string): readonly JudgedPick[] {
  const population = verdictPopulation(players, view.picks);
  const judged: JudgedPick[] = [];
  for (const review of reviewPicks(players, view.picks, myTeamId)) {
    const player = playersById.get(review.playerId);
    const boardRank = population.boardRanks.get(review.playerId);
    if (player === undefined || boardRank === undefined) continue;
    judged.push({ review, player, verdict: verdictFor(population, boardRank, review.pickNumber) });
  }
  return judged;
}

/**
 * THE DEBRIEF, AS THE SCREEN'S LOWER THIRD (Task 13, re-formed by Sunday v5's law 6). The plan's
 * own words: *"the results debrief is where the verdict chips accumulate into a story about how
 * you drafted."* Three facts — how many picks beat the board, how many did not, and the single
 * best one — and then the one verb the screen is actually waiting on.
 *
 * It used to sit at the TOP, beside a row of three equally-weighted buttons where a manager had
 * to choose which of them was the point. Law 6 gives the verb a place: "Run another mock draft"
 * is the act, it goes last in the strip, and the two ways out stay quiet up in the headline row.
 *
 * The two counts carry no comparison, on purpose — there is no stated population a count of
 * steals falls inside, and law 1 permits a tint only where the comparison is genuine. They are
 * big because they matter, not coloured because they are good. The best pick's own chip IS
 * coloured, because that number has a real population behind it (the picks this room made).
 *
 * The labels live here rather than in `MOCK_COPY`: the verdict vocabulary is the draft ROOM's own
 * language, rendered in the pool and the wire of every league whether or not it is a practice
 * room, and `MOCK_COPY` is for words that are specifically about mock drafts. The house copy
 * rules still bind — `rendered-copy.test.tsx` mounts this component and sweeps every string it
 * paints.
 */
function debriefCells(judged: readonly JudgedPick[]): readonly LowerThirdCell[] {
  const steals = judged.filter((entry) => entry.verdict.kind === "steal");
  const reaches = judged.filter((entry) => entry.verdict.kind === "reach");
  // The single pick that beat the board by most. Absent for a manager who never beat it, which
  // is an honest silence rather than a "best" that was merely least bad.
  const best = steals.reduce<JudgedPick | null>((leader, entry) => (leader === null || entry.verdict.slip > leader.verdict.slip ? entry : leader), null);
  const cells: LowerThirdCell[] = [
    { label: steals.length === 1 ? "Steal" : "Steals", value: steals.length },
    { label: reaches.length === 1 ? "Reach" : "Reaches", value: reaches.length },
  ];
  if (best !== null) {
    cells.push({
      label: "Best pick",
      value: (
        <span className="inline-flex items-baseline gap-2">
          <span className="truncate">{best.player.name}</span>
          <VerdictChip verdict={best.verdict} />
        </span>
      ),
    });
  }
  return cells;
}

function PickList({
  judged,
  copy,
}: {
  readonly judged: readonly JudgedPick[];
  readonly copy: MockResultsCopy;
}) {
  // A record, not prose (results review E1): one tabular mono row per pick — number, face,
  // name, position, the verdict, then the honest board fact. Weight, never color, marks the
  // extremes of the FACT column (the R2 register ruling); colour belongs only to the chip, which
  // is a `Stat` and therefore the one thing here allowed to carry it.
  //
  // Still a hairline-separated list rather than a stack of cards: rule 4's amended test says a
  // thing you read down a column stays a row, and a finished pick log is exactly that — nothing
  // here is acted on, and the whole point is to scan the column.
  return (
    <div className="flex flex-col gap-2">
      <h2 className={`${EYEBROW} text-text-muted`}>{copy.picksHeading}</h2>
      {judged.length === 0 ? (
        <p className="text-sm text-text-muted">{copy.noPicksMessage}</p>
      ) : (
        <ol aria-label={copy.picksHeading} className="flex flex-col">
          {judged.map(({ review, player, verdict }) => {
            const best = review.bestAvailableDelta === 0 || review.positionBestDelta === 0;
            return (
              <li key={review.pickNumber} className="flex items-center gap-3 border-t border-line py-2 first:border-t-0">
                <span className="w-8 shrink-0 font-mono text-xs tabular-nums text-text-muted">{review.pickNumber}</span>
                {/* Law 3: the club colour behind the face, on every surface that draws a
                    player. This log was the one place in the room still drawing a bare
                    `Avatar` — the same drift `RosterRow` was extracted to prevent. */}
                <PlayerFace player={player} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{player.name}</span>
                {/* The position rank rides the sticker (`WR6`), the way the pool has always
                    drawn it — it used to be printed as prose at the end of every row's fact
                    clause, which spent a column restating what a five-character badge says. */}
                <PositionBadge position={player.position} rank={review.positionRank} size="sm" />
                <VerdictChip verdict={verdict} />
                {/* A fixed track, not a second `flex-1`: the clause is three or four words now
                    ("Best available", "2 ranked higher"), and letting it claim half the row was
                    what made a column of near-identical phrases read as the loudest thing in the
                    log. The width it gives back goes to the NAME, which is the thing being
                    scanned. */}
                <span className={`hidden w-40 shrink-0 truncate text-right font-mono text-xs tabular-nums sm:block ${best ? "font-semibold text-text-primary" : "text-text-muted"}`}>
                  {formatPickFactClause(copy.pickFact, review, player.position)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/**
 * The post-draft panel for a mock room (Task 8, Step 2). On `phase === "complete"`, `DraftRoom`
 * lets this yield the whole board: your roster grouped by slot, your pick list with each pick's
 * honest board facts (`reviewPicks`, `../state/pick-review`: best available at that pick, and at
 * that position, both computed from the pool order the draft itself snapshotted at start — never
 * a live ranking), the retention sentence, and the room's three next actions.
 *
 * Deliberately NO letter grade (ruling 5) — a grade manufactures authority this platform has not
 * earned, and the real-only rule forbids it. The pick facts are the honest version of the same
 * itch: what you actually took, against what the board actually still had, both facts of this
 * one draft. Ruling R2 (the mock-results design review, 2026-08-26): a raw, un-normalized board
 * rank implies exactly the verdict ruling 5 refuses, and points it backwards for any pick late in
 * a long draft — best-available-at-the-pick never drifts with the round the way raw rank does.
 */
export function MockResults({ view, teams, board, players, myTeamId, copy, actions }: MockResultsProps) {
  const playersById = buildPlayersById(players);
  // The debrief's meta line (review E5) — every clause a fact the props already held: your
  // seat, the room's shape, who you played. Composed only for a caller WITH a seat.
  const seat = myTeamId === null ? 0 : view.draftOrder.indexOf(myTeamId) + 1;
  const myName = teams.find((team) => team.id === myTeamId)?.name ?? null;
  const rounds = view.draftOrder.length === 0 ? 0 : Math.floor(view.picks.length / view.draftOrder.length);
  const bots = teams.filter((team) => team.isBot === true).length;
  // Built once, read twice: the debrief counts them and the log lists them. Two derivations of
  // one verdict is how a page ends up saying "3 steals" over a list that shows four.
  const judged = myTeamId === null ? [] : judgedPicks(view, players, playersById, myTeamId);
  return (
    // Full-bleed (review E2/R1): the frame spends the screen it is given; the team sheet takes
    // its own measure as a grid column, the pick log takes the rest, the finished board takes
    // the width. Mobile order (review E9): team first, the way out before the log — order
    // utilities re-sequence the single column without duplicating a region.
    <section aria-label="Mock draft results" className="flex w-full flex-col gap-8 p-6">
      {/* FOUNDER 2026-08-27 ("there's no navigation at the top of a finished mock draft"): the
          way out rides the headline, not the foot of the page. It used to sit inside the grid
          below — `order-2` put it above the pick log on a phone, which was right, but
          `lg:order-3` put it below BOTH the roster and a fifteen-round pick list on a desktop,
          so finishing a mock left you scrolling a full screen of your own picks to find the
          thing you actually wanted next. The headline row was carrying nothing but empty space
          to its right at exactly that width. One block, every width: still before the log on a
          phone, now beside the headline on a desktop. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-display-md font-semibold leading-display text-text-primary">{copy.heading}</h1>
          {myTeamId === null || seat === 0 ? null : (
            <p className="font-mono text-xs tabular-nums text-text-muted">
              {myName === null ? "" : `${myName} · `}
              {`seat ${seat} of ${view.draftOrder.length} · ${rounds} rounds · ${bots} practice opponents`}
            </p>
          )}
          {/* ONE retention fact per view (review E3): the practice banner above this panel
              already says the room clears itself — `copy.retentionSentence` stays on the wire
              for any chrome-less consumer but is deliberately not restated here. */}
        </div>
        {/* The two ways OUT stay here, quiet. The one ACT ("Run another mock draft") moved to
            the strip at the foot, because law 6 says that is where a verb lives — and because
            three equally weighted buttons in a row made a manager choose which of them was the
            point of the screen. */}
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {actions.openLobby}
          {actions.browseLeagues}
        </div>
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        {myTeamId === null ? null : (
          <>
            {/* `min-w-0` on both grid items, and it is load-bearing at 360px
                (`TOKENS.minViewport`): a grid item's default `min-width: auto` is its CONTENT, so
                a roster row's own face plus sticker stretched this column past the viewport and
                the whole PAGE scrolled sideways. Not the column: the page. */}
            <div className="order-1 min-w-0">
              <RosterSection view={view} playersById={playersById} myTeamId={myTeamId} copy={copy} />
            </div>
            <div className="order-2 min-w-0">
              <PickList judged={judged} copy={copy} />
            </div>
          </>
        )}
        {/* The finished board (review R3/E7) — for EVERY caller, including the commissioner
            with no team, for whom the room's own completed picture is the whole point. */}
        <div className="order-3 min-h-0 min-w-0 lg:col-span-2">{board}</div>
      </div>
      {/* LAW 6: the screen ends in a lower third. The story this draft told (steals, reaches,
          the single best pick) and then the one act it is waiting on. A commissioner who watched
          without a seat has no story to tell, so the strip carries the verb alone rather than
          three cells of zeroes. */}
      <div data-testid="mock-debrief" className="-mx-6 -mb-6 mt-2">
        <LowerThird cells={debriefCells(judged)} action={actions.runAgain} />
      </div>
    </section>
  );
}
