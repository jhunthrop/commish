import { eq } from "drizzle-orm";
import { assembleAdvisorContext } from "@/ai-advisor/context";
import type { Db } from "@/db/client";
import { drafts, integrityFlags, leagues, matchups, rosterSlots, scoringSettings, teams, tradeProposals } from "@/db/schema";
import { ADVISOR_CONFIG } from "@/domain/advisor";
import type { Position } from "@/domain/player";
import { STANDARD_ROSTER_SLOTS, type RosterSlotType } from "@/domain/roster";
import { PPR_SCORING } from "@/domain/scoring";
import type { Clock } from "@/domain/timing";
import { assignSlot, snakeTeamForPick, totalRosterSlots } from "@/draft-engine";
import { rankedPlayers } from "@/draft-service/pool";
import type { AuditLogger } from "@/integrity-service/audit-logger";
import { notifyAffectedMember, type MemberNotice } from "@/integrity-service/notify";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { LEAGUE_CONFIG } from "@/league";
import { acceptTrade, proposeTrade } from "@/league-service/trades";
import { TRADE_CONFIG } from "@/trades/config";
import { ensureDevUsers } from "./dev-users";

const LEAGUE_ID = "dev_league_trades";
const DRAFT_ID = "dev_draft_trades";
const TEAM_COUNT = 4;
/** Indices 4..7 of `ensureDevUsers`' fixed pool — clear of index 0 (the founder's claim slot) and
 *  of 8..11 (`seedMultiAccountSuspect`'s own suspects), reused deliberately the same way that
 *  file's own docblock explains: a dev user already fielding a team elsewhere fielding one more
 *  here is what a real member joining a second league looks like. */
const TEAM_OWNER_INDICES = [4, 5, 6, 7] as const;

/**
 * `LEAGUE_CONFIG.maxWeeks` (18) — the app's own declared ceiling, never `regularSeasonWeeks + 1`
 * (14 + 1 = 15). `stat_weeks` is GLOBAL (`src/db/schema.ts`'s own `week` primary key, not scoped
 * by league), and on a long-lived dev database the ingestion worker's own repeated ticking
 * (`e2e/global-setup.ts`'s `tickUntilLiveWeekReached`, run over and over across many suite runs)
 * can walk stat_weeks PAST week 14 over time — week 15 was observed locked on a database that had
 * accumulated runs before this fixture existed. The worker cannot walk past week 17 no matter how
 * many times it runs, because the committed mock dataset's own last week IS 17
 * (`createMockStatsProvider().lastWeekOfSeason`) — `listGames`/`getGameStatLines` simply have
 * nothing to return past it. `maxWeeks` (18) sits one past that real, structural ceiling, so this
 * is safe forever, not just today. The dataset carries stat lines for weeks 15-17 too, which is
 * what gives `evaluateTradeBeforeExecute`'s own trend window (`ADVISOR_CONFIG.trendWeeks` weeks
 * immediately before) real numbers to value players from, rather than the all-zero average a
 * truly untouched week would price everyone at.
 *
 * The trades themselves no longer NAME this week — `proposeTrade`/`acceptTrade` derive it (final
 * review, CRITICAL 1). This constant is now what this fixture writes into the league's own
 * schedule (the single unscored matchup below), so `currentWeekOf` answers exactly this number
 * for this league, plus the week `benchRosterFor` prices candidate packages at so the band search
 * and the real detector agree.
 */
const WEEK_NUMBER = LEAGUE_CONFIG.maxWeeks;

/**
 * Ruling 29's own gap, closed: the seed proposes and accepts three real trades so a real
 * `trade_fairness` flag sits in the operator queue beside Plan B's real multi-account one — one
 * even trade nobody would question, one lopsided trade the advisor calls out to a manager's face
 * but that never reaches an operator, and one grotesque trade that crosses
 * `INTEGRITY_CONFIG.trade.fairnessFlagThreshold` and does. `evenDelta`/`lopsidedDelta` name the
 * first two bands; the flag threshold names the third. All three axes on the identical points-
 * per-week scale `tradeBalance` itself uses (`@/trades/fairness`'s own docblock).
 */
const GAP_BAND = {
  even: (gap: number): boolean => gap <= ADVISOR_CONFIG.evenDelta,
  lopsidedBelowThreshold: (gap: number): boolean => gap > ADVISOR_CONFIG.lopsidedDelta && gap < INTEGRITY_CONFIG.trade.fairnessFlagThreshold,
  grotesque: (gap: number): boolean => gap >= INTEGRITY_CONFIG.trade.fairnessFlagThreshold,
} as const;

/** One trade this seed proposes and accepts, keyed by a STABLE id (never `crypto.randomUUID()`)
 *  so a re-run can tell "already did this one" from "still owes it" — the same row-level
 *  idempotency `seedMultiAccountSuspect`'s own draft-log guard keeps, one level finer. */
interface TradeFixture {
  readonly id: string;
  readonly label: string;
  readonly note: string;
  /** Whether a candidate pair's gap belongs in this band. */
  readonly matches: (gap: number) => boolean;
  /** `"min"` picks the closest-to-even pair inside the band (the even and lopsided-but-tolerated
   *  fixtures); `"max"` picks the widest gap available (the grotesque one — the whole point of
   *  that fixture is to be unmissable, not to just barely clear the threshold). */
  readonly prefer: "min" | "max";
}

const TRADE_FIXTURES: readonly TradeFixture[] = [
  { id: `${LEAGUE_ID}_trade_even`, label: "even", note: "Straight-up swap, nobody's complaining.", matches: GAP_BAND.even, prefer: "min" },
  {
    id: `${LEAGUE_ID}_trade_lopsided`,
    label: "lopsided-but-below-threshold",
    note: "One-sided, but not the kind of one-sided anyone reviews.",
    matches: GAP_BAND.lopsidedBelowThreshold,
    prefer: "min",
  },
  { id: `${LEAGUE_ID}_trade_grotesque`, label: "grotesque", note: "One of these teams is about to have a very bad week.", matches: GAP_BAND.grotesque, prefer: "max" },
];

interface ValuedRosterPlayer {
  readonly teamId: string;
  readonly playerId: string;
  readonly position: Position;
  readonly averagePoints: number;
}

interface ComboPick {
  readonly give: readonly ValuedRosterPlayer[];
  readonly get: readonly ValuedRosterPlayer[];
  readonly gap: number;
}

/** Every player currently on the bench, valued the exact way `evaluateTradeBeforeExecute` itself
 *  will value them a moment later — `assembleAdvisorContext`, the real read, never a second
 *  scoring path this file invents. BENCH ONLY, and that restriction is what makes the search
 *  below provably legal without simulating `plannedTransfer` at all: see `bestBenchCombo`'s own
 *  docblock. */
async function benchRosterFor(db: Db, teamId: string): Promise<readonly ValuedRosterPlayer[]> {
  const context = await assembleAdvisorContext(db, { leagueId: LEAGUE_ID, teamId, weekNumber: WEEK_NUMBER });
  if (context === null) {
    throw new Error(`seedTrades: team ${teamId} doesn't resolve in ${LEAGUE_ID} — seed its roster before seeding trades.`);
  }
  return context.me.players
    .filter((player) => player.slot === "BENCH")
    .map((player) => ({ teamId, playerId: player.playerId, position: player.position, averagePoints: player.averagePoints }));
}

function sumPoints(players: readonly ValuedRosterPlayer[]): number {
  return players.reduce((total, player) => total + player.averagePoints, 0);
}

/** Every way to choose exactly `size` items from `items`, order-independent. Bench rosters here
 *  are `STANDARD_ROSTER_SLOTS`' own 6-player bench, so this never explores more than a few dozen
 *  combinations per team — cheap enough to run exhaustively rather than heuristically. */
function combinationsOfSize<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  if (size === 0) return [[]];
  if (size > items.length) return [];
  const [head, ...rest] = items;
  const withHead = combinationsOfSize(rest, size - 1).map((combo) => [head!, ...combo]);
  const withoutHead = combinationsOfSize(rest, size);
  return [...withHead, ...withoutHead];
}

/**
 * The best equal-count, cross-team, BENCH-ONLY package trade whose aggregate gap belongs to one
 * fairness band — `tradeBalance`'s own `givingValue`/`receivingValue`, summed over however many
 * players each side sends, not just one.
 *
 * BENCH ONLY, EQUAL COUNT, AND THAT IS WHY THIS NEVER NEEDS TO SIMULATE `plannedTransfer` TO KNOW
 * IT IS LEGAL. Every roster this file deals is completely full (`dealRostersIfAbsent`). Clearing
 * `N` bench players from a full roster frees exactly `N` slots, every one of them the universal
 * acceptor (`STANDARD_ROSTER_SLOTS`' own `BENCH` entry takes every position) — so placing `N`
 * incoming players of ANY position mix always finds room, on both sides, for any `N` this
 * searches. A same-position restriction (this file's first draft) or an unequal-count package
 * would both need the real legality check re-run to be sure; equal-count bench-for-bench never
 * does, which is what makes a genuinely GROTESQUE gap reachable with a four-team, one-week-old
 * league whose same-position spread alone tops out well under the flag threshold.
 */
function bestBenchCombo(benchByTeam: ReadonlyMap<string, readonly ValuedRosterPlayer[]>, matches: (gap: number) => boolean, prefer: "min" | "max"): ComboPick | null {
  let best: ComboPick | null = null;
  const teamIds = [...benchByTeam.keys()];
  for (const giveTeamId of teamIds) {
    for (const getTeamId of teamIds) {
      if (giveTeamId === getTeamId) continue;
      const giveBench = benchByTeam.get(giveTeamId)!;
      const getBench = benchByTeam.get(getTeamId)!;
      const maxSize = Math.min(TRADE_CONFIG.maxAssetsPerSide, giveBench.length, getBench.length);
      for (let size = 1; size <= maxSize; size++) {
        for (const give of combinationsOfSize(giveBench, size)) {
          const giveSum = sumPoints(give);
          for (const get of combinationsOfSize(getBench, size)) {
            const gap = Math.abs(giveSum - sumPoints(get));
            if (!matches(gap)) continue;
            if (best === null || (prefer === "min" ? gap < best.gap : gap > best.gap)) best = { give, get, gap };
          }
        }
      }
    }
  }
  return best;
}

/** Deal full, legal rosters by walking a snake order over `rankedPlayers` and asking the ENGINE's
 *  own `assignSlot` where each player fits — the identical discipline `seedSeasonLeague` already
 *  keeps, at a fourth of its team count. Skipped entirely once any roster row already exists for
 *  these teams: re-dealing on a re-run would silently un-trade whatever this seed's own earlier
 *  run already moved, which is exactly the duplication idempotency here refuses to produce. */
async function dealRostersIfAbsent(db: Db, teamIds: readonly string[]): Promise<void> {
  const [existing] = await db.select({ teamId: rosterSlots.teamId }).from(rosterSlots).where(eq(rosterSlots.teamId, teamIds[0]!)).limit(1);
  if (existing !== undefined) return;

  const pool = await rankedPlayers(db, LEAGUE_ID);
  const taken = new Set<string>();
  const rosters = new Map(teamIds.map((id) => [id, [] as { slot: RosterSlotType; slotIndex: number; playerId: string }[]]));
  const totalPicks = teamIds.length * totalRosterSlots(STANDARD_ROSTER_SLOTS);

  for (let pickNumber = 1; pickNumber <= totalPicks; pickNumber++) {
    const teamId = snakeTeamForPick(teamIds, pickNumber);
    const roster = rosters.get(teamId)!;
    const sizeBefore = roster.length;
    for (const player of pool) {
      if (taken.has(player.id)) continue;
      const assignment = assignSlot({ position: player.position, roster, slotConfig: STANDARD_ROSTER_SLOTS });
      if (!assignment.ok) continue;
      taken.add(player.id);
      roster.push({ slot: assignment.slot, slotIndex: assignment.slotIndex, playerId: player.id });
      break;
    }
    if (roster.length === sizeBefore) {
      throw new Error(`seedTrades: no eligible player left in the pool for pick ${pickNumber} (team ${teamId}).`);
    }
  }

  const slotRows = [...rosters.entries()].flatMap(([teamId, slots]) => slots.map((slot) => ({ teamId, ...slot })));
  await db.insert(rosterSlots).values(slotRows);
}

/** Test seam only, mirroring `ProposeTradeInput`/`AcceptTradeInput`'s own `notify`/`deliver`/
 *  `audit` fields: production (`./index.ts`) supplies none of these, so every call underneath
 *  runs the real notifier, the real Redis publish and the real audit chain — exactly what "through
 *  the real routes" means. A test injects fakes here for the same reason `trades.test.ts` injects
 *  them directly: this file has no live Redis or audit table of its own to fail against. */
export interface SeedTradesDeps {
  readonly notify?: typeof notifyAffectedMember;
  readonly deliver?: (notice: MemberNotice) => Promise<void>;
  readonly audit?: AuditLogger;
}

export interface SeedTradesResult {
  readonly leagueId: string;
  readonly weekNumber: number;
  /** How many of the three named fixtures are `accepted`, counting rows a prior run already
   *  settled — never how many THIS call itself proposed. */
  readonly tradesAccepted: number;
  /** Real `trade_fairness` flags naming one of this seed's own three trades — one, always,
   *  raised by the grotesque fixture and by no other. */
  readonly flagsRaised: number;
}

/**
 * Ruling 29's own gap, closed: `npm run seed && npm run dev` puts a REAL `trade_fairness` flag in
 * the operator queue, raised by the real detector (`raiseTradeFairnessFlag`,
 * `@/integrity-service/trade-fairness`, called from INSIDE `acceptTrade` itself) from a real
 * accepted trade — never a decorative row this file inserts on its own. `src/data/seed/seed-
 * trades.test.ts`'s own drift tripwire greps this file's source for a direct write to either the
 * flags table or the trade-proposal table and fails if it ever finds one — this file only ever
 * reads those two tables, through `db.select`.
 *
 * THROUGH THE REAL ROUTES, the same discipline `seedMultiAccountSuspect` already keeps for its
 * own flag: `proposeTrade` and `acceptTrade` (`@/league-service/trades`) are called exactly as
 * `POST /api/leagues/[leagueId]/trades` and its `[tradeId]` sibling call them, with real rosters
 * a real detector prices — `acceptTrade`'s own `evaluateTradeBeforeExecute` call and the after-
 * commit `raiseTradeFairnessFlag` it triggers are untouched by anything here.
 *
 * Idempotent per-fixture, not just per-call: each of the three named trades (`TRADE_FIXTURES`)
 * carries a STABLE id, checked for existence before this function ever proposes it, so a re-run
 * skips whatever a prior run already settled rather than erroring on a player who has since moved
 * or duplicating a trade that already executed. `dealRostersIfAbsent` gives the same guarantee to
 * the rosters underneath: a re-run never un-trades what an earlier run already moved.
 */
export async function seedTrades(db: Db, clock: Clock, claimUserId?: string, deps: SeedTradesDeps = {}): Promise<SeedTradesResult> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seedTrades creates placeholder users and must never run in production.");
  }

  const ownerIds = await ensureDevUsers(db, claimUserId);
  const teamOwners = TEAM_OWNER_INDICES.map((index) => ownerIds[index]!);
  const teamIds = teamOwners.map((_, i) => `${LEAGUE_ID}_team_${i + 1}`);
  const userIdByTeamId = new Map(teamIds.map((id, i) => [id, teamOwners[i]!]));

  await db
    .insert(leagues)
    .values({ id: LEAGUE_ID, name: "Dev Trade League", format: "snake", teamCount: TEAM_COUNT, commissionerUserId: teamOwners[0]!, rosterSlots: [...STANDARD_ROSTER_SLOTS] })
    .onConflictDoUpdate({ target: leagues.id, set: { commissionerUserId: teamOwners[0]! } });

  await db.insert(scoringSettings).values({ leagueId: LEAGUE_ID, ...PPR_SCORING }).onConflictDoNothing({ target: scoringSettings.leagueId });

  await db
    .insert(teams)
    .values(teamIds.map((id, i) => ({ id, leagueId: LEAGUE_ID, userId: teamOwners[i]!, name: `Trade Fixture ${i + 1}` })))
    .onConflictDoNothing({ target: teams.id });

  await db
    .insert(drafts)
    .values({ id: DRAFT_ID, leagueId: LEAGUE_ID, format: "snake", status: "complete", kickoffAt: new Date(clock.now()), auctionBudget: null })
    .onConflictDoNothing({ target: drafts.id });

  // ONE unscored matchup at `WEEK_NUMBER`, the same anchor `e2e/global-setup.ts`'s own trades
  // league writes and for the same reason: `currentWeekOf` (`@/league-service/schedule`) is what
  // `proposeTrade`/`acceptTrade` derive their week from now (final review, CRITICAL 1), and a
  // schedule-less league answers week 1 — which, on a dev database the ingestion worker has
  // ticked, is long since `final` and would refuse every trade this fixture wants to accept.
  // Home vs away, never both directions: `matchups`' own primary key is `(league_id, week_number,
  // home_team_id)`.
  await db
    .insert(matchups)
    .values({ leagueId: LEAGUE_ID, weekNumber: WEEK_NUMBER, homeTeamId: teamIds[0]!, awayTeamId: teamIds[1]! })
    .onConflictDoNothing();

  await dealRostersIfAbsent(db, teamIds);

  let tradesAccepted = 0;
  for (const fixture of TRADE_FIXTURES) {
    const [existing] = await db.select().from(tradeProposals).where(eq(tradeProposals.id, fixture.id));

    if (existing !== undefined) {
      if (existing.status === "accepted") {
        tradesAccepted += 1;
        continue;
      }
      if (existing.status !== "open") {
        // Nothing else in this codebase ever settles a `${LEAGUE_ID}_trade_*` id — a rejected,
        // withdrawn, expired or superseded row here means something outside this function
        // touched it, and this seed has no honest way to recover that trade's own intent.
        throw new Error(`seedTrades: the "${fixture.label}" fixture (${fixture.id}) is "${existing.status}", not "accepted" — something else settled it.`);
      }
      // OPEN: a prior run's own propose succeeded and its accept did not (a crash, or a week
      // that was locked at the time — see `WEEK_NUMBER`'s own docblock). Resume from exactly
      // there rather than re-proposing, which would collide on this row's own primary key.
      // Trade governance (roadmap item 5): a seeder builds HISTORY — the review window is
      // fast-forwarded through the same finalize re-entry the lazy processor uses.
      const reviewed = await acceptTrade(db, {
        bypassDeadline: true,
        tradeId: existing.id,
        leagueId: LEAGUE_ID,
        userId: userIdByTeamId.get(existing.counterpartyTeamId)!,
        clock,
        notify: deps.notify,
        deliver: deps.deliver,
        audit: deps.audit,
      });
      const acceptResult =
        reviewed.ok && reviewed.outcome === "under_review"
          ? await acceptTrade(db, {
        bypassDeadline: true,
              tradeId: existing.id,
              leagueId: LEAGUE_ID,
              userId: userIdByTeamId.get(existing.counterpartyTeamId)!,
              clock,
              notify: deps.notify,
              deliver: deps.deliver,
              audit: deps.audit,
              finalizeReview: true,
            })
          : reviewed;
      if (!acceptResult.ok) {
        throw new Error(`seedTrades: resuming the "${fixture.label}" fixture's own acceptance was refused: ${acceptResult.reason}`);
      }
      tradesAccepted += 1;
      continue;
    }

    const benchByTeam = new Map(await Promise.all(teamIds.map(async (teamId) => [teamId, await benchRosterFor(db, teamId)] as const)));
    const pick = bestBenchCombo(benchByTeam, fixture.matches, fixture.prefer);
    if (pick === null) {
      throw new Error(`seedTrades: couldn't find a "${fixture.label}" candidate package among ${LEAGUE_ID}'s current bench rosters.`);
    }
    const giveTeamId = pick.give[0]!.teamId;
    const getTeamId = pick.get[0]!.teamId;

    const proposeResult = await proposeTrade(db, {
    // Seeder-manufactured history: the calendar deadline is bypassed, every other rule binds.
    bypassDeadline: true,
      leagueId: LEAGUE_ID,
      userId: userIdByTeamId.get(giveTeamId)!,
      counterpartyTeamId: getTeamId,
      proposerAssets: pick.give.map((player) => ({ kind: "player" as const, playerId: player.playerId })),
      counterpartyAssets: pick.get.map((player) => ({ kind: "player" as const, playerId: player.playerId })),
      note: fixture.note,
      clock,
      newId: () => fixture.id,
      notify: deps.notify,
      deliver: deps.deliver,
      audit: deps.audit,
    });
    if (!proposeResult.ok) {
      throw new Error(`seedTrades: the "${fixture.label}" fixture's own proposal was refused: ${proposeResult.reason}`);
    }

    const reviewed = await acceptTrade(db, {
        bypassDeadline: true,
      tradeId: proposeResult.tradeId,
      leagueId: LEAGUE_ID,
      userId: userIdByTeamId.get(getTeamId)!,
      clock,
      notify: deps.notify,
      deliver: deps.deliver,
      audit: deps.audit,
    });
    // Governance fast-forward, same reasoning as the resume branch above.
    const acceptResult =
      reviewed.ok && reviewed.outcome === "under_review"
        ? await acceptTrade(db, {
        bypassDeadline: true,
            tradeId: proposeResult.tradeId,
            leagueId: LEAGUE_ID,
            userId: userIdByTeamId.get(getTeamId)!,
            clock,
            notify: deps.notify,
            deliver: deps.deliver,
            audit: deps.audit,
            finalizeReview: true,
          })
        : reviewed;
    if (!acceptResult.ok) {
      throw new Error(`seedTrades: the "${fixture.label}" fixture's own acceptance was refused: ${acceptResult.reason}`);
    }
    tradesAccepted += 1;
  }

  // Read back, never trusted from `acceptTrade`'s own in-process result: this is what makes the
  // count correct on a resumed run too, where a fixture skipped above (already `accepted` from a
  // prior run) still needs its flag counted here.
  const fixtureIds = new Set(TRADE_FIXTURES.map((fixture) => fixture.id));
  const tradeFlagRows = await db.select({ subjectId: integrityFlags.subjectId }).from(integrityFlags).where(eq(integrityFlags.subjectType, "trade"));
  const flagsRaised = tradeFlagRows.filter((row) => fixtureIds.has(row.subjectId)).length;

  return { leagueId: LEAGUE_ID, weekNumber: WEEK_NUMBER, tradesAccepted, flagsRaised };
}
