import { and, asc, eq, gt, or, sql, type SQL } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { drafts, leagues, teams } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { DRAFT_SERVICE_CONFIG } from "@/draft-service/config";
import { getAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { LEAGUE_CONFIG } from "@/league";
import { HOUSE_CATALOG, houseKickoffFor, houseLeagueName, type HouseRung, type HouseRungName } from "@/matchmaking/house-catalog";
import { MS_PER_DAY } from "./config";
import { writeLeagueInTx, type CreateLeagueInput } from "./creation";

/**
 * The reconciler: "the lobby is never empty", made a fact about the database rather than a
 * promise about a script that ran once. `ensureHouseCatalog` counts every rung's open leagues
 * against `HOUSE_CATALOG` and opens exactly the shortfall — never more, never fewer, and never
 * by touching a league that already exists.
 *
 * A RECONCILER, NOT A HOOK (the decision that carries the rest, per the task brief): nothing
 * calls this the moment a house league fills. `src/draft-service/ticker.ts` calls it on an
 * interval instead, and that is what gives it its one real property — a partial failure leaves a
 * partly restocked shelf, which the NEXT tick finishes. There is no missed-event failure mode,
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
 * and the order `leagues_house_rung_idx` (`@/db/schema`) carries `created_at` as its second
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
 */
export function openHouseLeaguesQuery(db: Db, rung: HouseRungName, nowIso: string) {
  return db
    .select({ id: leagues.id, createdAt: leagues.createdAt })
    .from(leagues)
    .innerJoin(drafts, eq(drafts.leagueId, leagues.id))
    .leftJoin(teams, eq(teams.leagueId, leagues.id))
    .where(and(eq(leagues.houseRung, rung), eq(drafts.status, "scheduled"), houseKickoffStillAhead(nowIso)))
    .groupBy(leagues.id, drafts.id)
    .having(sql`count(${teams.id}) < ${leagues.teamCount}`)
    .orderBy(asc(leagues.createdAt));
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
}

export interface HouseFactoryOutcome {
  /** Every league id this call actually created, across every rung, in the order created. */
  readonly opened: readonly string[];
  /** A rung this call gave up restocking this tick, and why — never thrown, always reported,
   *  the same shape `AutoStartOutcome.reason` already is. */
  readonly refused: readonly { readonly rung: HouseRungName; readonly reason: string }[];
}

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
  const refused: { readonly rung: HouseRungName; readonly reason: string }[] = [];
  let budget = DRAFT_SERVICE_CONFIG.maxHouseSpawnsPerRun;

  for (const rungName of Object.keys(HOUSE_CATALOG.rungs) as HouseRungName[]) {
    const rung = HOUSE_CATALOG.rungs[rungName];
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

  return { opened, refused };
}
