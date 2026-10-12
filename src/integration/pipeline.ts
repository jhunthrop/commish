import type { Db } from "@research/db/client";
import { players, playerStatLines } from "@research/db/schema";
import { DRAFT_ACTION_VERSION } from "@research/domain/draft";
import type { DraftFormat } from "@/domain/league";
import { AUCTION_CONFIG, currentDeadline } from "@/draft-engine";
import { createDraftStore, type DraftStore } from "@/draft-service/store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";

/**
 * Shared by every test in `src/integration/**`. NOT a test file — no `describe`, no `it` — so
 * it is imported rather than run.
 *
 * `SPRINT_ROSTER_SLOTS` (QB/RB/WR) keeps a full, genuinely-finished draft to six picks for two
 * teams. Short is the point: this suite exists to prove the SEAM, and a sixteen-round standard
 * roster would prove the same seam twenty times more slowly.
 *
 * `runRealDraft` drives every turn with TIMER_EXPIRE alone, which is honest for a snake draft
 * (there is nothing else to submit) but was NOT honest for an auction: unopposed auto-nomination
 * never exercises `reduceNominate` or `reduceBid`, only `reduceAuctionExpiry`'s two branches.
 * `runAuctionDraftWithBiddingWar`, below, is the proof that closes that gap — a real NOMINATE
 * and a real back-and-forth of competing BIDs, through the same store, before any clock is
 * allowed to close the lot.
 */

/** One player per position per team slot, so a two-team sprint draft always fills. */
const POOL_ROWS = [
  { id: "qb1", name: "QB One", position: "QB" as const, nflTeam: "KC" },
  { id: "qb2", name: "QB Two", position: "QB" as const, nflTeam: "SF" },
  { id: "rb1", name: "RB One", position: "RB" as const, nflTeam: "KC" },
  { id: "rb2", name: "RB Two", position: "RB" as const, nflTeam: "SF" },
  { id: "wr1", name: "WR One", position: "WR" as const, nflTeam: "KC" },
  { id: "wr2", name: "WR Two", position: "WR" as const, nflTeam: "SF" },
];

/** Weekly production for the six pool players, so a scored week is not a table of zeroes. */
const STAT_LINES = [
  { playerId: "qb1", passingYards: 300, passingTouchdowns: 3 },
  { playerId: "qb2", passingYards: 210, passingTouchdowns: 1 },
  { playerId: "rb1", rushingYards: 120, rushingTouchdowns: 1 },
  { playerId: "rb2", rushingYards: 60, receptions: 3, receivingYards: 25 },
  { playerId: "wr1", receivingYards: 110, receptions: 8, receivingTouchdowns: 1 },
  { playerId: "wr2", receivingYards: 45, receptions: 4 },
];

export interface DraftedLeague {
  readonly draftId: string;
  readonly leagueId: string;
  readonly teamIds: readonly string[];
  readonly userIds: readonly string[];
}

const CLOCK = { now: () => "2026-09-01T00:00:00.000Z" };
/** Publishing is best-effort by contract; this suite proves persistence, not fan-out. */
const PUBLISH = async () => "1-0";
/** A finished draft in this suite cannot need more auto-expired turns than this; the cap is a
 *  hang guard, not a real limit — the pool sizes below stay far under it. */
const MAX_TURNS = 100;

/**
 * Expires the clock, over and over, until the draft is complete — the only action a real snake
 * draft ever needs, and what an auction falls back to once nothing is being manually contested.
 * Shared by `runRealDraft` and `runAuctionDraftWithBiddingWar` so "how an unattended draft
 * finishes" has exactly one implementation.
 */
async function finishByAutoExpire(store: DraftStore, draftId: string): Promise<void> {
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const state = await store.getDraftState(draftId);
    if (state === null) throw new Error("draft vanished mid-run");
    if (state.phase === "complete") return;
    // The reducer rejects an expiry before the deadline it actually set, so advance to that
    // deadline rather than reasoning about the clock's tightening tiers here.
    const result = await store.applyAction(draftId, {
      v: DRAFT_ACTION_VERSION,
      type: "TIMER_EXPIRE",
      timestamp: currentDeadline(state) ?? CLOCK.now(),
    });
    if (!result.ok) throw new Error(`turn ${turn} rejected: ${result.reason}`);
  }
  throw new Error("draft did not finish");
}

/**
 * Seeds a league and runs a REAL draft in it to completion, letting the clock autopick every
 * turn. The commit into rosters, picks and the season schedule is the store's OWN
 * commit-on-completion — nothing here calls `commitDraftState` by hand, because a test that
 * commits for itself proves only that the commit function works, not that a finished draft
 * actually triggers it.
 *
 * For an auction this drives only the auto-nominate/unopposed-award path — see
 * `runAuctionDraftWithBiddingWar` for the contested-lot proof.
 *
 * `key` namespaces the ids so several drafted leagues can coexist inside one test.
 */
export async function runRealDraft(db: Db, format: DraftFormat, key: string): Promise<DraftedLeague> {
  const fixture = await seedDraftFixture(db, {
    draftId: `${key}_draft`,
    leagueId: `${key}_league`,
    format,
    teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS,
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: format === "auction" ? 50 : null,
  });
  await db.insert(players).values(POOL_ROWS).onConflictDoNothing({ target: players.id });

  const store = createDraftStore({ db, publish: PUBLISH, clock: CLOCK });
  const started = await store.startDraft(fixture.draftId);
  if (!started.ok) throw new Error(`start failed: ${started.reason}`);

  await finishByAutoExpire(store, fixture.draftId);
  return { draftId: fixture.draftId, leagueId: fixture.leagueId, teamIds: fixture.teamIds, userIds: fixture.userIds };
}

/** Inserts one week of production for the sprint pool. Callers score against it. */
export async function seedWeekStats(db: Db, weekNumber: number): Promise<void> {
  await db
    .insert(playerStatLines)
    .values(STAT_LINES.map((line) => ({ ...line, week: weekNumber })))
    .onConflictDoNothing();
}

/**
 * A separate, three-team pool for `runAuctionDraftWithBiddingWar`. A bidding WAR needs a
 * nominator plus two other teams free to bid against each other, which `runRealDraft`'s
 * two-team fixture cannot provide — so this gets its own teams and its own players rather than
 * forcing a third team into the shared fixture that every other test in this suite depends on.
 */
const AUCTION_WAR_POOL_ROWS = [
  { id: "abw_qb1", name: "Auction QB One", position: "QB" as const, nflTeam: "KC" },
  { id: "abw_qb2", name: "Auction QB Two", position: "QB" as const, nflTeam: "SF" },
  { id: "abw_qb3", name: "Auction QB Three", position: "QB" as const, nflTeam: "DAL" },
  { id: "abw_rb1", name: "Auction RB One", position: "RB" as const, nflTeam: "KC" },
  { id: "abw_rb2", name: "Auction RB Two", position: "RB" as const, nflTeam: "SF" },
  { id: "abw_rb3", name: "Auction RB Three", position: "RB" as const, nflTeam: "DAL" },
  { id: "abw_wr1", name: "Auction WR One", position: "WR" as const, nflTeam: "KC" },
  { id: "abw_wr2", name: "Auction WR Two", position: "WR" as const, nflTeam: "SF" },
  { id: "abw_wr3", name: "Auction WR Three", position: "WR" as const, nflTeam: "DAL" },
];

/** Starting budget for the bidding-war fixture's three teams — comfortably above every raise
 *  below, so a bid is never rejected by the budget ceiling rather than by the assertion it's
 *  meant to exercise. Exported so the test computing "expected remaining budget" reads the same
 *  constant this module seeded rather than restating it as a literal. */
export const AUCTION_WAR_BUDGET = 50;

export interface AuctionLotContest {
  readonly playerId: string;
  readonly nominatingTeamId: string;
  readonly winningTeamId: string;
  readonly finalPrice: number;
  /** The winner's exact remaining auction budget the instant this lot was awarded — read back
   *  from the store's own replayed state, not computed independently, so a drift between the
   *  reducer's deduction and this field is impossible. */
  readonly winnerBudgetAfter: number;
}

/**
 * Drives ONE auction lot through a genuine contest, entirely through the real store's
 * `applyAction`: a manual NOMINATE at the floor, then every bid in `raises` in order, then a
 * TIMER_EXPIRE that must award the lot to whoever placed the LAST bid — never back to the
 * nominator sitting on its own opening bid, and never at the opening bid itself.
 */
async function contestAuctionLot(
  store: DraftStore,
  draftId: string,
  nominatingTeamId: string,
  playerId: string,
  raises: readonly { readonly teamId: string; readonly amount: number }[],
): Promise<AuctionLotContest> {
  const nominated = await store.applyAction(draftId, {
    v: DRAFT_ACTION_VERSION,
    type: "NOMINATE",
    timestamp: CLOCK.now(),
    teamId: nominatingTeamId,
    playerId,
    openingBid: AUCTION_CONFIG.minBid,
  });
  if (!nominated.ok) throw new Error(`nominate rejected: ${nominated.reason}`);

  for (const raise of raises) {
    const bid = await store.applyAction(draftId, { v: DRAFT_ACTION_VERSION, type: "BID", timestamp: CLOCK.now(), teamId: raise.teamId, amount: raise.amount });
    if (!bid.ok) throw new Error(`bid rejected: ${bid.reason}`);
  }
  // Guarded by every caller passing a non-empty `raises` — asserted here so a future caller's
  // mistake fails loudly instead of silently crediting the nominator with a win they didn't bid.
  const lastRaise = raises[raises.length - 1];
  if (lastRaise === undefined) throw new Error("a contested lot needs at least one raise");

  const beforeExpiry = await store.getDraftState(draftId);
  if (beforeExpiry === null) throw new Error("draft vanished mid-run");
  const expired = await store.applyAction(draftId, {
    v: DRAFT_ACTION_VERSION,
    type: "TIMER_EXPIRE",
    timestamp: currentDeadline(beforeExpiry) ?? CLOCK.now(),
  });
  if (!expired.ok) throw new Error(`timer expire rejected: ${expired.reason}`);

  const after = await store.getDraftState(draftId);
  if (after === null) throw new Error("draft vanished mid-run");

  return {
    playerId,
    nominatingTeamId,
    winningTeamId: lastRaise.teamId,
    finalPrice: lastRaise.amount,
    winnerBudgetAfter: after.budgets[lastRaise.teamId] ?? 0,
  };
}

/**
 * Seeds a fresh three-team auction league and proves the two reducers `runRealDraft` never
 * exercises: `reduceNominate` and `reduceBid`. Two lots — one QB, one RB, so neither contest's
 * bidders are ever blocked by a slot the other already filled — each get a real opening
 * NOMINATE from whichever team is actually on the clock, followed by four real, escalating BIDs
 * traded between the two OTHER teams, before TIMER_EXPIRE is allowed to close it. The two
 * contests are steered (never handed to a team that already won one) so each winner's budget
 * delta is attributable to exactly one price, which is what makes the budget assertion exact
 * rather than approximate. Every remaining pick then auto-completes exactly like
 * `runRealDraft`'s does, through the same shared `finishByAutoExpire`.
 */
export async function runAuctionDraftWithBiddingWar(
  db: Db,
  key: string,
): Promise<{ readonly league: DraftedLeague; readonly contests: readonly AuctionLotContest[] }> {
  const fixture = await seedDraftFixture(db, {
    draftId: `${key}_draft`,
    leagueId: `${key}_league`,
    format: "auction",
    teamCount: 3,
    slotConfig: SPRINT_ROSTER_SLOTS,
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: AUCTION_WAR_BUDGET,
  });
  await db.insert(players).values(AUCTION_WAR_POOL_ROWS).onConflictDoNothing({ target: players.id });

  const store = createDraftStore({ db, publish: PUBLISH, clock: CLOCK });
  const started = await store.startDraft(fixture.draftId);
  if (!started.ok) throw new Error(`start failed: ${started.reason}`);

  const contests: AuctionLotContest[] = [];
  const alreadyWon = new Set<string>();
  for (const playerId of ["abw_qb1", "abw_rb1"] as const) {
    const state = await store.getDraftState(fixture.draftId);
    if (state === null || state.auction === null || state.auction.nominatingTeamId === null) {
      throw new Error("draft is not in a live auction turn");
    }
    const nominatingTeamId = state.auction.nominatingTeamId;
    const others = state.draftOrder.filter((teamId) => teamId !== nominatingTeamId);
    if (others.length < 2) throw new Error("a bidding war needs at least two other teams");

    // Whichever of the two other teams hasn't already won a lot bids last, so it wins this one
    // too — keeping each contest's winner distinct and its budget delta attributable to
    // exactly the one price this lot cleared at.
    const winner = others.find((teamId) => !alreadyWon.has(teamId)) ?? others[0]!;
    const runnerUp = others.find((teamId) => teamId !== winner) ?? others[1]!;

    const contest = await contestAuctionLot(store, fixture.draftId, nominatingTeamId, playerId, [
      { teamId: runnerUp, amount: 5 },
      { teamId: winner, amount: 10 },
      { teamId: runnerUp, amount: 15 },
      { teamId: winner, amount: 20 },
    ]);
    alreadyWon.add(contest.winningTeamId);
    contests.push(contest);
  }

  await finishByAutoExpire(store, fixture.draftId);
  return {
    league: { draftId: fixture.draftId, leagueId: fixture.leagueId, teamIds: fixture.teamIds, userIds: fixture.userIds },
    contests,
  };
}
