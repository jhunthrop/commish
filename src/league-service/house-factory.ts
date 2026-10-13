import { and, asc, eq, gt, or, sql, type SQL } from "drizzle-orm";
import type { Db, DbTx, ReadonlyDb } from "@research-ts/db/client";
import { drafts, leagues, teams } from "@/db/schema";
import type { Clock } from "@research-ts/domain/timing";
import { DRAFT_SERVICE_CONFIG } from "@/draft-service/config";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { LEAGUE_CONFIG } from "@/league";
import { HOUSE_CATALOG, houseKickoffFor, houseLeagueName, type HouseRung, type HouseRungName } from "@/matchmaking/house-catalog";
import { dissolveLeague } from "@/money-service/dissolution";
import { MS_PER_DAY } from "./config";
import { writeLeagueInTx, type CreateLeagueInput } from "./creation";
import { liveHoldsFor } from "./seat-hold";

/**
 * The reconciler: "the lobby is never empty", made a fact about the database rather than a
 * promise about a script that ran once. `ensureHouseCatalog` counts every rung's open leagues
 * against `HOUSE_CATALOG` and opens exactly the shortfall — never more, never fewer, and never
 * by touching a league that already exists.
 *
 * A RECONCILER, NOT A HOOK (the decision that carries the rest, per the task brief): nothing
 * calls this the moment a house league fills. The minute sweep (`@/jobs/defs/draft-sweep-job`,
 * on every host since the batched bots round) calls it on its fires instead, and that is what
 * gives it its one real property — a partial failure leaves a partly restocked shelf, which the
 * NEXT fire finishes. There is no missed-event failure mode,
 * because there is no event to miss.
 */

/**
 * "This house league's draft can still happen" — the ONE expression of the kickoff half of
 * "standing open", shared by the reconciler's count (`openHouseLeaguesQuery`, below) and the
 * public shelf (`houseShelfQuery`, `./browse.ts`) so the two can never disagree about which
 * leagues are on the shelf. Two expressions of one rule is how a drift starts, and this
 * particular drift would be invisible: the shelf would render a league the reconciler had already
 * replaced, or the reconciler would restock a slot the shelf still shows as occupied.
 *
 * True for a `when_full` rung unconditionally — its `kickoff_at` is a far-future placeholder
 * until `fireWhenFullInTx` (`./fill-trigger.ts`) writes a real one on the last seat, so the
 * column does not yet mean what a clock comparison would read it as. True for a `scheduled` rung
 * only while its chosen time is still ahead. See `openHouseLeaguesQuery`'s docblock for the
 * permanent stall this closes.
 */
export function houseKickoffStillAhead(nowIso: string): SQL | undefined {
  return or(eq(drafts.startTrigger, "when_full"), gt(drafts.kickoffAt, new Date(nowIso)));
}

/**
 * Every house league of `rung` currently occupying a shelf slot: its draft is still `scheduled`
 * AND it has a free seat — the identical pair `browseQuery` (`@/league-service/browse.ts`)
 * already reads, so the reconciler's count and the browse page's own idea of "still joinable"
 * can never disagree. Exported as the query BUILDER, the same shape `browseQuery`/
 * `dueDraftsQuery`/`liveDraftsQuery` already use, so `src/db/index-plans.test.ts` can `EXPLAIN`
 * the real thing rather than a hand copy.
 *
 * Ordered by `created_at` ascending — the order THIS reconciler needs (each new spawn gets the
 * next stagger slot, `openIndex` below, off how many of the rung's own leagues already exist),
 * and the order `leagues_house_rung_idx` (`@research-ts/db/schema`) carries `created_at` as its second
 * column for.
 *
 * NOT the order the shelf itself is read in. An earlier draft of this docblock (and of the
 * index's own) assumed creation order and Task 14's soonest-draft shelf order would coincide,
 * because a `scheduled` rung's kickoff IS creation-ordered WITHIN that one rung
 * (`houseKickoffFor`'s own stagger). They do not coincide ACROSS rungs — `open_12` and
 * `beginner_12` stagger on independent clocks — so the shelf reads through its own query,
 * ordered on `drafts.kickoff_at` (`houseShelfQuery`, `@/league-service/browse.ts`), never this
 * one.
 *
 * STILL IN THE FUTURE, for a `scheduled` rung (final whole-branch review, F2). Without the
 * kickoff predicate an under-filled scheduled-trigger house league whose time has PASSED occupied
 * a shelf slot forever: `reduceStart` (`@/draft-engine`) refuses a draft with fewer than two
 * teams, so its status never leaves `'scheduled'`; this count therefore never saw a shortfall, so
 * the reconciler never restocked the slot; and `houseShelfQuery` kept rendering it at the TOP of
 * the shelf, reading "starting now", forever. Nothing could repair it by hand either, because a
 * house league's kickoff refuses edits by design (`HOUSE_AUTHORITY_REFUSALS.schedule`). One
 * predicate on both queries retires the stale league from both roles at once: it stops counting,
 * so the next reconciler pass opens a fresh edition in its place, and it stops rendering.
 *
 * `when_full` rungs are EXEMPT from it, and that is not an edge case being waved through: a
 * sit-and-go draft has no chosen time at all until `fireWhenFullInTx` writes one on the last seat,
 * and the placeholder it carries until then (`kickoffFor`, below) is a far-future date precisely
 * so nothing mistakes it for a real one. Judging it by the clock would be judging a value that
 * does not mean what the column's name says.
 *
 * `nowIso` is INJECTED, never `now()` in SQL — the repo-wide clock discipline (`docs/conventions.md`),
 * which is also what lets `house-factory.test.ts` seed a passed kickoff without waiting for one.
 *
 * NOT AN ABANDONMENT STATE MACHINE, deliberately. A stale draft is still scanned by
 * `dueDraftsQuery`/`autoStartDueDrafts` (`@/draft-service/auto-start`) every tick and still
 * refused by `reduceStart` every time, which is a bounded no-op over a bounded set, not a leak.
 * Phase 3.6's Task 7 ("roll until full") replaces this whole door — a house league that cannot
 * start rolls its own kickoff forward instead of being retired — so a retirement state written
 * here would be built to be deleted.
 *
 * `filledTeams` (storefront review E13) rides the SAME `count(teams.id)` this query's own
 * `HAVING` already computes — added to the projection, not a second aggregate, so
 * `retirementCandidates` below can tell an empty shelf slot from a partly-seated one without a
 * second query over the identical join.
 */
export function openHouseLeaguesQuery(db: Db, rung: HouseRungName, nowIso: string) {
  return db
    .select({ id: leagues.id, createdAt: leagues.createdAt, filledTeams: sql<number>`count(${teams.id})::int` })
    .from(leagues)
    .innerJoin(drafts, eq(drafts.leagueId, leagues.id))
    .leftJoin(teams, eq(teams.leagueId, leagues.id))
    .where(and(eq(leagues.houseRung, rung), eq(drafts.status, "scheduled"), houseKickoffStillAhead(nowIso)))
    .groupBy(leagues.id, drafts.id)
    .having(sql`count(${teams.id}) < ${leagues.teamCount}`)
    .orderBy(asc(leagues.createdAt));
}

/**
 * Storefront review E13: "too many open tournaments at once" was the founder's own complaint, and
 * width dropped 6 -> 2 (`open_12`/`beginner_12` at `openAtOnce: 1` apiece) — but the reconciler
 * only ever opened the shortfall, never closed a surplus, so the six legacy leagues the
 * 2026-08-26 directive left behind (migration `0044` converted them to `when_full`, never
 * shrank the shelf) sit on the rung forever. This is the surplus half of "keep the shelf at
 * `openAtOnce`", read from the SAME `open` list `ensureHouseCatalog` already fetched for the
 * shortfall side, so there is no second query to disagree with it.
 *
 * THE RULE, EXACTLY: when `open.length` exceeds `rung.openAtOnce`, the surplus — oldest first,
 * `open` is already ordered that way — is retired ONE SEAT AT A TIME, but only among leagues
 * NOBODY HAS JOINED (`filledTeams === 0`) AND NOBODY IS MID-CLAIMING (wave-1 review A2: no LIVE
 * seat hold). A league with even one seated team is never a candidate: the shelf can carry more
 * than `openAtOnce` leagues indefinitely if every surplus league already has a member in it, and
 * that is correct — a seated manager is never evicted to make the shelf's own width arithmetic
 * come out even.
 *
 * THE HOLD CHECK REUSES THE PRODUCT'S ONE OCCUPANCY RULE, never a second copy of it: `liveHoldsFor`
 * (`./seat-hold.ts`) is the exact predicate `claimSeatHold` and `joinLeagueInTx` both gate a real
 * seat on (`hasOpenSeat`, `@/matchmaking/filter`) and the exact one `heldSeatsByLeagueId`
 * (`./browse.ts`) already re-reads for the public shelf's own "spots left" count — retiring a
 * league mid-claim would hand a visitor's ten-minute hold a room that no longer exists. An expired
 * hold is not live by that SAME predicate (`expires_at > now`), so it protects nothing: the league
 * becomes a candidate again on the very next tick that reads past its expiry.
 */
async function retirementCandidates(
  db: ReadonlyDb,
  nowIso: string,
  open: readonly { readonly id: string; readonly createdAt: Date; readonly filledTeams: number }[],
  openAtOnce: number,
): Promise<readonly string[]> {
  const surplus = open.length - openAtOnce;
  if (surplus <= 0) return [];
  const candidates: string[] = [];
  for (const league of open) {
    if (candidates.length >= surplus) break;
    if (league.filledTeams !== 0) continue;
    const liveHolds = await liveHoldsFor(db, league.id, nowIso);
    if (liveHolds > 0) continue;
    candidates.push(league.id);
  }
  return candidates;
}

/**
 * The rung encoded in a house league's own id (`house_${rung}_${edition}`, the same shape
 * `nextEdition` below constructs and reads back) — the one place outside this module allowed to
 * know that shape, so the sweep's own retirement log (`@/jobs/defs/draft-sweep-job`, wave-1
 * review Q3) never restates the id format itself. `undefined` for anything that is not a real
 * house league id, rather than throwing — this feeds an operational log line, never a gate.
 */
export function rungOfHouseLeagueId(leagueId: string): HouseRungName | undefined {
  const rungNames = Object.keys(HOUSE_CATALOG.rungs) as HouseRungName[];
  return rungNames.find((name) => leagueId.startsWith(`house_${name}_`));
}

/**
 * One more than the highest edition `rung` has EVER had — not the highest currently open, so a
 * replacement league's id is never reused (Task 13, Step 5, ruling 35: "a replacement is never a
 * resurrection"). Scans every league this rung has ever produced, filled or open, through the
 * SAME partial index `openHouseLeaguesQuery` narrows on (`leagues_house_rung_idx`), because the
 * id's own edition suffix is not itself an indexed column — the population this queries is small
 * by construction (a handful of leagues per rung, growing one at a time, never shrinking).
 */
async function nextEdition(db: Db, rung: HouseRungName): Promise<number> {
  const prefix = `house_${rung}_`;
  const rows = await db.select({ id: leagues.id }).from(leagues).where(eq(leagues.houseRung, rung));
  let highest = 0;
  for (const row of rows) {
    const edition = Number(row.id.slice(prefix.length));
    if (Number.isFinite(edition) && edition > highest) highest = edition;
  }
  return highest + 1;
}

/**
 * A `scheduled`-trigger rung's `openIndex`-th open seat gets a real, staggered kickoff
 * (`houseKickoffFor`); a `when_full` rung gets the identical placeholder every member-created
 * sit-and-go league gets today (`createLeague`'s own fallback, `@/league-service/creation.ts`) —
 * `LEAGUE_CONFIG.defaults.draftDaysFromCreation` out, far enough that `dueDraftsQuery`
 * (`@/draft-service/auto-start.ts`) never mistakes an empty sit-and-go room for a due draft
 * before `fireWhenFullInTx` (`./fill-trigger.ts`) ever moves it.
 */
function kickoffFor(rung: HouseRung, clock: Clock, openIndex: number): Date {
  if (rung.startTrigger === "when_full") {
    return new Date(Date.parse(clock.now()) + LEAGUE_CONFIG.defaults.draftDaysFromCreation * MS_PER_DAY);
  }
  return new Date(houseKickoffFor(clock.now(), rung, openIndex));
}

export interface HouseFactoryDeps {
  readonly clock: Clock;
  /** Draft ids only — `spawnHouseLeagueInTx` computes the league's own id itself
   *  (`house_${rung}_${edition}`), the one id in this product a caller never generates. */
  readonly newId: () => string;
  readonly audit?: AuditLogger;
  /**
   * Whether the retire half runs (storefront review E13's dissolution of member-less surplus
   * house leagues). Defaults to true for the callers that always had it (the seed, the tests);
   * the minute sweep passes `houseRetireEnabled(process.env)`, off unless `HOUSE_RETIRE_ENABLED`
   * says so (founder ruling, the batched bots round: the sweep restocks the shelf on every host
   * now, and the founder decides when production starts dissolving).
   */
  readonly retire?: boolean;
}

/** `HOUSE_RETIRE_ENABLED=1` (or `true`) turns the sweep's retire half on; anything else is off. */
export function houseRetireEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.HOUSE_RETIRE_ENABLED === "1" || env.HOUSE_RETIRE_ENABLED === "true";
}

export interface HouseFactoryOutcome {
  /** Every league id this call actually created, across every rung, in the order created. */
  readonly opened: readonly string[];
  /** Every league id this call actually retired (storefront review E13), across every rung, in
   *  the order dissolved — oldest-empty-first within a rung, never a league with a seated team. */
  readonly retired: readonly string[];
  /** A rung this call gave up restocking OR retiring this tick, and why — never thrown, always
   *  reported, the same shape `AutoStartOutcome.reason` already is. */
  readonly refused: readonly { readonly rung: HouseRungName; readonly reason: string }[];
}

/**
 * The reconciler's own system actor (storefront review E13) — `dissolveLeague`
 * (`@/money-service/dissolution`) is an OPERATOR door, built for `withAdmin`'s verified session,
 * and `operatorUserId` is carried on the `league_dissolved` audit payload for a human console's
 * trail, never as a foreign key (no `users` row named `"house-reconciler"` needs to exist). No
 * other headless writer in this codebase invokes an operator-shaped door (grepped: every
 * `operatorUserId` caller in `src/app/api/admin/**` reads it from `withAdmin`'s own session) — this
 * is the first, so the sentinel is named here rather than reusing a human's id or `null`, which
 * `dissolveLeague`'s own type does not accept.
 */
export const HOUSE_RECONCILER_ACTOR = "house-reconciler";

/**
 * `HOUSE_LEAGUE_OPENED_SUMMARY`'s the league-wide sentence `house_league_opened`'s `system_action`
 * carries. `SYSTEM_ACTION_VISIBILITY.house_league_opened` (`@/integrity/system-actions`) is
 * `"everyone"`, on `DRAFT_FILL_TRIGGERED_SUMMARY`'s (`./fill-trigger.ts`) own reasoning: a fact
 * about the league's shared calendar, true for everyone in it, about nobody's conduct.
 */
export const HOUSE_LEAGUE_OPENED_SUMMARY = "The platform opened this league for anyone to join.";

/**
 * One catalog spawn, run inside a transaction the caller (`ensureHouseCatalog`, below) already
 * holds open. Builds the SAME `CreateLeagueInput` shape a member creation would (Task 13, Step
 * 3's `owner: { kind: "house", rung }` branch) and writes it through `writeLeagueInTx`
 * (`./creation.ts`) — one write shape for both owners, never a second transaction hand-rolled
 * here that could drift from it.
 *
 * FK ACQUISITIONS, ENUMERATED (`src/integrity-service/lock-order.test.ts`'s own discipline). The
 * `leagues` INSERT takes NO parent lock at all: its only FK, `commissioner_user_id`, is `NULL`
 * for a house league, and a null FK acquires nothing (a small, pleasant consequence of ruling
 * 28). `scoring_settings` and `drafts` each take an implicit `FOR KEY SHARE` on the new `leagues`
 * row through their own `league_id` FK — nothing else has ever held that row, since it did not
 * exist before this statement. NO `teams` insert happens at all. The audit append is last, TWICE:
 * `writeLeagueInTx`'s own `league_created` event, then this function's `house_league_opened`
 * `system_action` — both on the new league's own chain (`scopeFor(leagueId)`, a non-null league
 * id), both after every FK-carrying insert above them, neither creating a new lock-ordering edge
 * because the anchor row this transaction touches did not exist a statement earlier either.
 */
export async function spawnHouseLeagueInTx(
  tx: DbTx,
  params: {
    readonly leagueId: string;
    readonly draftId: string;
    readonly rung: HouseRungName;
    readonly edition: number;
    readonly kickoffAt: Date;
    readonly clock: Clock;
    readonly audit: AuditLogger;
  },
): Promise<{ readonly claimed: boolean }> {
  const rung = HOUSE_CATALOG.rungs[params.rung];
  const input: CreateLeagueInput = {
    name: houseLeagueName(params.rung, params.edition),
    format: rung.format,
    teamCount: rung.teamCount,
    scoringPreset: rung.scoringPreset,
    auctionBudget: null,
    rosterShape: rung.rosterShape,
    medianGame: rung.medianGame,
    experienceTier: rung.experienceTier,
    stakeTier: rung.stakeTier,
    isPublicMatchmade: true,
    startTrigger: rung.startTrigger,
    owner: { kind: "house", rung: params.rung },
    // Phase 4, Task 8: the rung's fee terms flow through the one write shape, `0`/`0`/`null`
    // for every rung until the founder flips one in `house-catalog.ts` — `writeLeagueInTx`'s own
    // `leagueMoneyOrRefuse` re-validation is what makes a mis-flipped rung throw here rather
    // than store a table settlement could never balance.
    entryFeeCents: rung.entryFeeCents,
    platformFeeCents: rung.platformFeeCents,
    payoutTable: rung.payoutTable,
  };

  const outcome = await writeLeagueInTx(
    tx,
    { leagueId: params.leagueId, teamId: null, draftId: params.draftId },
    input,
    params.kickoffAt,
    params.clock,
    params.audit,
  );
  if (!outcome.claimed) return { claimed: false };

  await params.audit.record(tx, {
    eventType: "system_action",
    actorId: null,
    actorType: "system",
    leagueId: params.leagueId,
    payload: { action: "house_league_opened", summary: HOUSE_LEAGUE_OPENED_SUMMARY },
    occurredAt: params.clock.now(),
  });
  return { claimed: true };
}

/**
 * Storefront review E13: retires `rungName`'s surplus empty leagues (`retirementCandidates`
 * above), oldest first, spending from the SHARED `budget` counter every rung draws from — the
 * identical shared-counter shape `ensureHouseCatalog`'s own spawn `budget` already uses, so one
 * rung with a large legacy surplus cannot starve every other rung's own retirement this tick.
 *
 * Rides the EXISTING operator dissolution door (`dissolveLeague`, `@/money-service/dissolution`)
 * headlessly — a house league is a REAL league with real audit rows, so deletion is blocked by
 * the audit triggers the same way any league's would be; `dissolveLeague` is the one writer this
 * codebase already has for "close a room nobody is coming back to fill", and an empty league's
 * refund-all is a no-op over zero seated members (its own `entryFeeCents > 0` gate never runs,
 * `seated.length` is `0`, so zero refunds and zero notices post) — the audit trail still records
 * the dissolution, which is the whole point: a retired league is CLOSED, never deleted, so its
 * row and its history survive exactly as `dissolveLeague`'s own docblock already guarantees for
 * a paid league's members.
 *
 * NEVER RETIRES A SEATED LEAGUE, BELT AND SUSPENDERS, FOR REAL (wave-1 review A1 closed the gap
 * that made this claim false before): the belt is `retirementCandidates`' own `filledTeams === 0`
 * filter, read from a snapshot taken BEFORE this function's own transaction ever opens; the
 * suspenders is `dissolveLeague`'s `expectSeatedCount: 0` passed below, re-verified INSIDE that
 * transaction against a FRESH read taken under the `leagues[X] FOR UPDATE` lock. A league seated
 * between the snapshot and the call — the exact race the belt alone could never see — now refuses
 * there instead of refunding a manager who just joined. NEVER RETIRES A NON-HOUSE LEAGUE either:
 * `open` is always this ONE rung's own `openHouseLeaguesQuery` result, which is scoped to
 * `leagues.house_rung = rungName` in its own `WHERE` — this function never receives, and could not
 * construct, a candidate id from any other league.
 *
 * Never throws past one league's own failure, the identical discipline the spawn loop below
 * holds itself to: a refusal (the draft raced into starting, or the league vanished) is reported
 * on `refused` and the loop moves to the next candidate rather than abandoning the whole rung.
 */
async function retireSurplusForRung(
  db: Db,
  rungName: HouseRungName,
  candidates: readonly string[],
  deps: HouseFactoryDeps,
  audit: AuditLogger,
  budget: { remaining: number },
): Promise<{ readonly retired: readonly string[]; readonly refused: readonly { readonly rung: HouseRungName; readonly reason: string }[] }> {
  const retired: string[] = [];
  const refused: { readonly rung: HouseRungName; readonly reason: string }[] = [];

  for (const leagueId of candidates) {
    if (budget.remaining <= 0) break;
    budget.remaining -= 1;
    try {
      const result = await dissolveLeague(
        db,
        { leagueId, operatorUserId: HOUSE_RECONCILER_ACTOR, expectSeatedCount: 0 },
        { clock: deps.clock, audit, newId: deps.newId },
      );
      if (result.ok) retired.push(leagueId);
      else refused.push({ rung: rungName, reason: result.reason });
    } catch (error: unknown) {
      console.error("[house-factory] retire failed for rung", rungName, error);
      refused.push({ rung: rungName, reason: "Something went wrong retiring this league." });
    }
  }

  return { retired, refused };
}

/**
 * For every rung: count the open leagues, compute the shortfall, open exactly that many — one
 * league per transaction (never all of a rung's shortfall in one), because the lock order is
 * "business writes, then the audit anchor" per transaction, and batching three spawns would hold
 * three different `leagues` row locks across three audit appends for no benefit.
 *
 * NO ADVISORY LOCK (`docs/decisions/data-layer-hardening.md` forbids one under PgBouncer
 * transaction pooling, `autoStartDueDrafts`'s own docblock restates why). Two instances
 * reconciling the same rung on the same tick RESOLVE the race instead of avoiding it: each
 * iteration re-reads both the open count and the next edition FRESH, immediately before
 * attempting an insert, so a lost race (another instance's insert already committed) is visible
 * on the very next read rather than assumed away — the loop simply asks again whether the shelf
 * is still short, rather than trusting a shortfall it computed a moment (and, under a race, a
 * lifetime) earlier.
 *
 * Bounded by `DRAFT_SERVICE_CONFIG.maxHouseSpawnsPerRun` across every rung combined, following
 * `maxDraftsPerTick`/`AUTO_SET_CONFIG.maxLeaguesPerRun`. Never throws past one rung's own
 * failure, following `autoStartDueDrafts`: a spawn attempt that throws is logged and reported on
 * `refused`, and this function moves on to the next rung rather than leaving every later rung
 * unreconciled because one earlier one had a bad tick.
 */
export async function ensureHouseCatalog(db: Db, deps: HouseFactoryDeps): Promise<HouseFactoryOutcome> {
  const audit = deps.audit ?? getAuditLogger();
  const opened: string[] = [];
  const retired: string[] = [];
  const refused: { readonly rung: HouseRungName; readonly reason: string }[] = [];
  let budget = DRAFT_SERVICE_CONFIG.maxHouseSpawnsPerRun;
  const retireBudget = { remaining: DRAFT_SERVICE_CONFIG.maxHouseRetiresPerRun };

  for (const rungName of Object.keys(HOUSE_CATALOG.rungs) as HouseRungName[]) {
    const rung = HOUSE_CATALOG.rungs[rungName];

    // RETIRE FIRST (storefront review E13) — a surplus this rung is carrying today is real
    // regardless of what the shortfall side finds a moment later, and retiring first means the
    // shortfall loop's own FRESH re-read (below) already sees the narrowed shelf rather than
    // computing against a surplus this same call is about to close.
    const openBeforeRetire = await openHouseLeaguesQuery(db, rungName, deps.clock.now());
    const candidates = deps.retire === false ? [] : await retirementCandidates(db, deps.clock.now(), openBeforeRetire, rung.openAtOnce);
    if (candidates.length > 0) {
      const outcome = await retireSurplusForRung(db, rungName, candidates, deps, audit, retireBudget);
      retired.push(...outcome.retired);
      refused.push(...outcome.refused);
    }

    // Generous slack over `openAtOnce` for lost races between two concurrent instances — each
    // lost race still makes real progress (the winner's league now counts toward the shelf), so
    // this is headroom against a pathological run of bad luck, not a number either instance is
    // expected to approach in ordinary operation.
    const attemptCeiling = rung.openAtOnce * 3;
    let attempts = 0;

    while (budget > 0 && attempts < attemptCeiling) {
      // The clock is read per iteration, not hoisted: each pass re-reads the open count FRESH
      // (see this function's docblock on the two-instance race), and a count is only as fresh as
      // the instant its kickoff predicate is measured against.
      const open = await openHouseLeaguesQuery(db, rungName, deps.clock.now());
      if (open.length >= rung.openAtOnce) break;

      attempts += 1;
      budget -= 1;
      try {
        const edition = await nextEdition(db, rungName);
        const leagueId = `house_${rungName}_${edition}`;
        const draftId = deps.newId();
        const kickoffAt = kickoffFor(rung, deps.clock, open.length);

        let claimed = false;
        await db.transaction(async (tx) => {
          const outcome = await spawnHouseLeagueInTx(tx, { leagueId, draftId, rung: rungName, edition, kickoffAt, clock: deps.clock, audit });
          claimed = outcome.claimed;
        });
        if (claimed) opened.push(leagueId);
      } catch (error: unknown) {
        console.error("[house-factory] spawn failed for rung", rungName, error);
        refused.push({ rung: rungName, reason: "Something went wrong opening this league." });
        break;
      }
    }
  }

  return { opened, retired, refused };
}
