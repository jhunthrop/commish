"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { TeamCard } from "@/domain/league";
import type { Player, Position } from "@research-ts/domain/player";
import type { DraftStateView } from "@/draft-engine";
import { Button, ButtonLink, EYEBROW, PlayerFace, PositionBadge } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { formatDate } from "@/league-room/lib/format";
import { PlayerName } from "@/league-room/components/player-peek";
import type { MockResultsCopy, MockResultsInfo, MockResultsYourGrade } from "../contract";
import { useDraftRoomDeps } from "../hooks/deps";
import { playersById as buildPlayersById } from "../lib/lookups";
import { verdictFor, verdictPopulation, type Verdict } from "../lib/verdict";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import {
  byeStackWeek,
  debriefCounts,
  formatPickSlot,
  positionShape,
  roomAverageFirstRound,
  firstRoundByPosition,
} from "../state/debrief";
import { fillCopyTemplate, formatPickFactClause } from "../state/format";
import { reviewPicks, type PickReview } from "../state/pick-review";
import { rosterFillRows } from "../state/roster-fill";
import { seedOrderFrom, writeSeedSheet } from "../quilt/state/sheet-seed";
import { VerdictChip } from "./verdict-chip";

/**
 * THE DEBRIEF (the workflow pass, law 4 — `Debrief.dc.html` is the blueprint): summary stat
 * cards, the full pick-by-pick verdict lane, THE TEAM YOU BUILT, TAKE IT WITH YOU, the
 * across-your-mocks habits card, and RUN IT BACK, SAME TABLE as the page's one solid verb.
 *
 * HONESTY, unchanged in kind from the surface this rebuilds: every verdict is the board at the
 * moment of the pick (`reviewPicks`/`verdictPopulation` — the ONE derivation), the aggregates
 * are counts OF those verdicts (`debriefCounts`), the room-average clause renders only when
 * every other seat actually drafted the position (`roomAverageFirstRound`'s gate), the bye
 * clause only from the real schedule read (`byeWeeks`), and the habits card only from stored
 * completed mocks, computed server-side (`MockResultsInfo.habits`).
 *
 * SUPERSEDED (Task 11, plan ruling R-2, `docs/superpowers/plans/2026-09-05-draft-hq-room.md`):
 * this docblock used to end here with "No letter grade, ever (ruling 5) — a debrief states
 * facts, it never scores them." That ruling stood from the 2026-08-26 mock-results pass, and its
 * reasoning is kept rather than erased: an uncited letter tells a manager they lost without
 * saying why, which is a judgment, not a fact. `docs/superpowers/specs/2026-09-04-draft-hq-design
 * .md` §9 and its §15 ruling 3 are newer and founder-ruled, and answer that exact objection
 * instead of ignoring it: every draft earns a grade, mock included, and the grade always cites
 * the components behind its letter on the same card — value captured, starting slots filled, bye
 * collisions, projected points, the identical facts `GradeBoard`
 * (`@/league-room/components/grade-board`) shows for a real league. A cited letter is a
 * compressed fact, not a verdict from nowhere, which is what the old rule actually objected to.
 * PRIVATE always (ruling 3, spec §15): `YourGradeCard` below renders only the requesting
 * manager's own grade, computed fresh at read time since a mock stores nothing — never another
 * seat's.
 */
export interface MockResultsProps {
  readonly view: DraftStateView;
  /** The seats, for the meta line (your seat, the room's shape, who you played). */
  readonly teams: readonly TeamCard[];
  /** The room's own finished board — still the strongest image the product makes (results
   *  review R3), rendered under the debrief for every caller including the commissioner. */
  readonly board: ReactNode;
  /** In the same ranked order `START_DRAFT` snapshots — what makes every board fact a fact of
   *  THIS draft's own log rather than a live, still-moving ranking. */
  readonly players: readonly Player[];
  /** NFL team code → bye week (`DraftPlayersBody.byeWeeks`, the real schedule read). */
  readonly byeWeeks: ReadonlyMap<string, number>;
  /** Null for a commissioner watching a mock without a team of their own. */
  readonly myTeamId: string | null;
  readonly results: MockResultsInfo;
}

interface JudgedPick {
  readonly review: PickReview;
  readonly player: Player;
  readonly verdict: Verdict;
}

/** One derivation for the lane AND the cards — `verdictPopulation` over the whole room, so a
 *  manager is never graded on a curve of one. */
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

function StatCard({ value, caption }: { readonly value: string; readonly caption: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-md bg-surface-elevated px-3.5 py-2.5">
      <span className="font-display text-2xl font-bold tabular-nums text-text-primary">{value}</span>
      <span className="text-xs text-text-faint">{caption}</span>
    </div>
  );
}

/**
 * The three summary cards: the two verdict counts and the first-tight-end fact. The room
 * average rides the third card ONLY when every other seat drafted a tight end — the clause
 * drops silently otherwise (the canvas honesty law, decided by `roomAverageFirstRound`).
 */
function SummaryCards({
  view,
  positionOf,
  myTeamId,
  reviews,
  copy,
}: {
  readonly view: DraftStateView;
  readonly positionOf: ReadonlyMap<string, Position>;
  readonly myTeamId: string;
  readonly reviews: readonly PickReview[];
  readonly copy: MockResultsCopy;
}) {
  const counts = debriefCounts(reviews);
  const firstTe = firstRoundByPosition(view.picks, positionOf, myTeamId).get("TE") ?? null;
  const roomTe = roomAverageFirstRound(view.picks, positionOf, view.draftOrder, "TE", myTeamId);
  const teCaption =
    firstTe === null
      ? copy.statNoTeCaption
      : roomTe === null
        ? copy.statFirstTeCaption
        : `${copy.statFirstTeCaption} · ${fillCopyTemplate(copy.roomAverageClause, { round: String(roomTe) })}`;
  return (
    <div className="flex flex-wrap gap-2.5">
      <StatCard value={`${counts.bestAvailable} of ${counts.total}`} caption={copy.statBestAvailableCaption} />
      <StatCard
        value={String(counts.reaches)}
        caption={fillCopyTemplate(copy.statReachCaption, { threshold: String(DRAFT_ROOM_CONFIG.debrief.reachRankedHigher) })}
      />
      <StatCard value={firstTe === null ? "0" : `R${firstTe}`} caption={teCaption} />
    </div>
  );
}

/** The verdict lane: every pick — slot, sticker, name, the honest fact clause, the chip. */
function VerdictLane({
  leagueId,
  judged,
  teamCount,
  copy,
}: {
  readonly leagueId: string;
  readonly judged: readonly JudgedPick[];
  readonly teamCount: number;
  readonly copy: MockResultsCopy;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className={`${EYEBROW} text-text-muted`}>{copy.picksHeading}</h2>
      {judged.length === 0 ? (
        <p className="text-sm text-text-muted">{copy.noPicksMessage}</p>
      ) : (
        <ol aria-label={copy.picksHeading} className="flex flex-col">
          {judged.map(({ review, player, verdict }) => (
            <li key={review.pickNumber} className="flex items-center gap-3 border-t border-line py-2 first:border-t-0">
              <span className="w-10 shrink-0 font-mono text-xs tabular-nums text-text-muted">{formatPickSlot(review.pickNumber, teamCount)}</span>
              <PlayerFace player={player} size="sm" />
              <PlayerName
                leagueId={leagueId}
                playerId={player.id}
                name={player.name}
                className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary"
              />
              <PositionBadge position={player.position} rank={review.positionRank} size="sm" />
              <VerdictChip verdict={verdict} />
              <span
                className={`hidden w-40 shrink-0 truncate text-right font-mono text-xs tabular-nums sm:block ${
                  review.bestAvailableDelta === 0 || review.positionBestDelta === 0 ? "font-semibold text-text-primary" : "text-text-muted"
                }`}
              >
                {formatPickFactClause(copy.pickFact, review, player.position)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * THE TEAM YOU BUILT: the roster's position stickers in slot order, the shape sentence, and —
 * only when three or more rostered players sit out the same week — the bye-stacking clause,
 * from the real schedule read alone.
 */
function TeamCardSection({
  view,
  playersById,
  positionOf,
  byeWeeks,
  myTeamId,
  copy,
}: {
  readonly view: DraftStateView;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly positionOf: ReadonlyMap<string, Position>;
  readonly byeWeeks: ReadonlyMap<string, number>;
  readonly myTeamId: string;
  readonly copy: MockResultsCopy;
}) {
  const rows = rosterFillRows(view.slotConfig, view.rosters[myTeamId] ?? []);
  const filled = rows.filter((row) => row.playerId !== null);
  const shape = positionShape(view.picks, positionOf, myTeamId);
  const nflTeams = filled
    .map((row) => playersById.get(row.playerId!)?.nflTeam)
    .filter((team): team is string => team !== undefined);
  const stacked = byeStackWeek(nflTeams, byeWeeks);
  const sentences: string[] = [];
  if (shape.leader !== null) {
    sentences.push(
      fillCopyTemplate(copy.shapeSentence, {
        count: String(shape.leader.count),
        position: shape.leader.position,
        rounds: String(DRAFT_ROOM_CONFIG.debrief.shapeRounds),
      }),
    );
  }
  if (stacked !== null) {
    sentences.push(fillCopyTemplate(copy.byeStackSentence, { week: String(stacked.week), count: String(stacked.count) }));
  }
  return (
    <section aria-label={copy.teamHeading} className="flex flex-col gap-2 rounded-lg bg-surface-elevated p-3.5 shadow-card">
      <h2 className={`${MICRO_LABEL} text-text-faint`}>{copy.teamHeading}</h2>
      <div className="flex flex-wrap gap-1">
        {filled.map((row) => {
          const player = playersById.get(row.playerId!);
          return player === undefined ? null : <PositionBadge key={`${row.slot}:${row.slotIndex}`} position={player.position} size="sm" />;
        })}
      </div>
      {sentences.length === 0 ? null : <p className="text-sm text-text-muted">{sentences.join(" ")}</p>}
    </section>
  );
}

/** `grade.components.valueCaptured`, one decimal — `GradeBoard`'s own formatting
 *  (`@/league-room/components/grade-board`), kept identical so the same number reads the same way
 *  on both cards. */
function formatValueCaptured(value: number): string {
  return value.toFixed(1);
}

/**
 * YOUR GRADE (Task 11, plan ruling R-2): private to the requesting manager, computed fresh at
 * read time (a mock stores nothing) and always shown WITH the components behind the letter —
 * `GradeBoard`'s own copy patterns for a single team rather than a room table. Renders nothing
 * when `results.yourGrade` is null, whether that is because there was no board to grade against
 * or because this caller has no seat in the room at all.
 */
function YourGradeCard({ yourGrade }: { readonly yourGrade: MockResultsYourGrade | null }) {
  if (yourGrade === null) return null;
  const { grade, boardGeneration } = yourGrade;
  return (
    <section aria-label="Your grade" className="flex flex-col gap-2 rounded-lg bg-surface-elevated p-3.5 shadow-card">
      <h2 className={`${MICRO_LABEL} text-text-faint`}>Your grade</h2>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-3xl font-bold text-text-primary">{grade.letter}</span>
        <span className="text-sm tabular-nums text-text-muted">{formatValueCaptured(grade.components.valueCaptured)} value captured</span>
      </div>
      <dl className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs">
        <div className="flex flex-col">
          <dt className="text-text-faint">Starting slots filled</dt>
          <dd className="tabular-nums text-text-primary">
            {grade.components.startingSlotsFilled} of {grade.components.startingSlotsTotal}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-text-faint">Bye collisions</dt>
          <dd className="tabular-nums text-text-primary">{grade.components.byeCollisions}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-text-faint">Projected points</dt>
          <dd className="tabular-nums text-text-primary">{grade.components.projectedPoints.toFixed(1)}</dd>
        </div>
      </dl>
      <p className="text-xs text-text-faint">Graded against our board of {formatDate(boardGeneration)}</p>
    </section>
  );
}

/** ACROSS YOUR LAST MOCKS — renders only what the server derived from 2+ stored mocks; a
 *  clause whose fact is missing (a mock with no tight end) drops, the card stays. */
function HabitsSection({ results }: { readonly results: MockResultsInfo }) {
  const habits = results.habits;
  if (habits === null) return null;
  const { copy } = results;
  const heading = fillCopyTemplate(copy.habitsHeading, { count: String(habits.mockCount) });
  return (
    <section aria-label={heading} className="flex flex-col gap-2 rounded-lg bg-surface-elevated p-3.5 shadow-card">
      <h2 className={`${MICRO_LABEL} text-text-faint`}>{heading}</h2>
      {habits.firstTeRounds === null ? null : (
        <p className="text-sm text-text-muted">
          {fillCopyTemplate(copy.habitsTeSentence, { rounds: spokenRounds(habits.firstTeRounds) })}
        </p>
      )}
      <p className="text-sm text-text-muted">
        {fillCopyTemplate(copy.habitsEarlySentence, {
          count: String(habits.earlyBestAvailableCount),
          total: String(habits.mockCount),
        })}
      </p>
    </section>
  );
}

/** "6, 7 and 5" — a spoken list, no dash, no oxford ceremony. */
export function spokenRounds(rounds: readonly number[]): string {
  if (rounds.length === 1) return String(rounds[0]);
  return `${rounds.slice(0, -1).join(", ")} and ${rounds[rounds.length - 1]}`;
}

export function MockResults({ view, teams, board, players, byeWeeks, myTeamId, results }: MockResultsProps) {
  const router = useRouter();
  const { fetchJson } = useDraftRoomDeps();
  const [busy, setBusy] = useState<"back" | "seat" | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { copy, table } = results;
  const playersById = buildPlayersById(players);
  const positionOf = new Map(players.map((player) => [player.id, player.position]));
  const seat = myTeamId === null ? 0 : view.draftOrder.indexOf(myTeamId) + 1;
  const myName = teams.find((team) => team.id === myTeamId)?.name ?? null;
  const rounds = view.draftOrder.length === 0 ? 0 : Math.floor(view.picks.length / view.draftOrder.length);
  const bots = teams.filter((team) => team.isBot === true).length;
  const judged = myTeamId === null ? [] : judgedPicks(view, players, playersById, myTeamId);
  const reviews = judged.map((entry) => entry.review);
  // The seat the rematch offers: any seat other than the one just played, seat 1 by preference
  // (the blueprint's own suggestion), 2 when 1 was yours.
  const otherSeat = seat === 1 ? 2 : 1;

  /** RUN IT BACK / TRY ANOTHER SEAT: one POST, the SAME create door every entry uses — this
   *  room's own re-derived table (`MockResultsInfo.table`), never a guessed one. */
  const rematch = async (kind: "back" | "seat"): Promise<void> => {
    if (table === null) return;
    setBusy(kind);
    setError(null);
    try {
      const response = await fetchJson("/api/mock-drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "solo",
          teamCount: table.teamCount,
          pickSeconds: table.pickSeconds,
          scoringPreset: table.scoringPreset,
          rosterShape: table.rosterShape,
          ...(kind === "back" && seat > 0 ? { draftSlot: seat } : {}),
          ...(kind === "seat" ? { draftSlot: otherSeat } : {}),
        }),
      });
      const body = (await response.json()) as ApiEnvelope<{ readonly draftId: string }>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      router.push(`/app/drafts/${body.data.draftId}`);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const seedSheetNow = (): void => {
    const order = seedOrderFrom(
      judged.map((entry) => entry.review.playerId),
      players.map((player) => player.id),
    );
    if (writeSeedSheet(order)) setSeeded(true);
  };

  return (
    <section aria-label="Mock draft results" className="flex w-full flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-display-md font-semibold leading-display text-text-primary">{copy.heading}</h1>
          {myTeamId === null || seat === 0 ? null : (
            <p className="font-mono text-xs tabular-nums text-text-muted">
              {myName === null ? "" : `${myName} · `}
              {`seat ${seat} of ${view.draftOrder.length} · ${rounds} rounds · ${bots} practice opponents`}
            </p>
          )}
        </div>
        {/* Law 4 + the amber budget: RUN IT BACK is this page's ONE solid; the lobby stays the
            quiet way out ("never a dead end", Task 8's rule, kept). */}
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <ButtonLink href="/app/draft/mock-drafts" variant="secondary">
            {copy.openLobbyLabel}
          </ButtonLink>
          {table === null ? null : (
            <Button variant="verb" size="lg" onClick={() => void rematch("back")} loading={busy === "back"} disabled={busy !== null}>
              {copy.runBackVerb}
            </Button>
          )}
        </div>
      </div>

      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {myTeamId === null ? null : (
          <>
            <div className="order-1 flex min-w-0 flex-col gap-4">
              <SummaryCards view={view} positionOf={positionOf} myTeamId={myTeamId} reviews={reviews} copy={copy} />
              <VerdictLane leagueId={view.leagueId} judged={judged} teamCount={view.draftOrder.length} copy={copy} />
            </div>
            <div className="order-2 flex min-w-0 flex-col gap-3">
              <TeamCardSection view={view} playersById={playersById} positionOf={positionOf} byeWeeks={byeWeeks} myTeamId={myTeamId} copy={copy} />
              <YourGradeCard yourGrade={results.yourGrade} />
              {/* TAKE IT WITH YOU — the loop back to the real room. Outline verbs, never the
                  solid: the page's one act is the rematch in the headline. */}
              <section aria-label={copy.takeItHeading} className="flex flex-col gap-2 rounded-lg bg-surface-elevated p-3.5 shadow-card ring-2 ring-accent/40">
                <h2 className={`${MICRO_LABEL} text-accent`}>{copy.takeItHeading}</h2>
                <p className="text-sm text-text-muted">{copy.seedDetail}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={seedSheetNow} disabled={seeded || judged.length === 0}>
                    {copy.seedVerb}
                  </Button>
                  {table === null || seat === 0 ? null : (
                    <Button variant="secondary" size="sm" onClick={() => void rematch("seat")} loading={busy === "seat"} disabled={busy !== null}>
                      {fillCopyTemplate(copy.trySeatVerb, { seat: String(otherSeat) })}
                    </Button>
                  )}
                </div>
                {seeded ? (
                  <p role="status" className="text-xs text-text-muted">
                    {copy.seededConfirmation}
                  </p>
                ) : null}
              </section>
              <HabitsSection results={results} />
            </div>
          </>
        )}
        {/* The finished board — for EVERY caller, including the commissioner with no seat, for
            whom the room's own completed picture is the whole point. */}
        <div className="order-3 min-h-0 min-w-0 lg:col-span-2">{board}</div>
      </div>
    </section>
  );
}
