import { readFileSync } from "node:fs";
import { and, desc, eq } from "drizzle-orm";
import { DEV_SEED } from "../src/data/seed/config";
import { createDb } from "../src/db/client";
import { memberNotices, teams, tradeProposals, users } from "../src/db/schema";
import { formatDraftTime } from "../src/league";
import { ENFORCEMENT_REFUSALS } from "../src/league-service/enforcement";
import { expect, expectNotice, test } from "./support/fixtures";
import {
  E2E_DRAFT_SCHEDULE_INVITE_STATE,
  E2E_DRAFT_SCHEDULE_LEAGUE_ID,
  E2E_HELD_TRADE_FIXTURE_STATE,
  E2E_HELD_TRADE_LEAGUE_ID,
  E2E_HELD_TRADE_TEAM_B_ID,
  MANAGER_A_EMAIL,
  MANAGER_A_STATE,
  MANAGER_B_STATE,
  type DraftScheduleInvite,
  type HeldTradeFixture,
} from "./global-setup";

/**
 * Whether manager A already has a `tier_blocked_join` notice for this league BEFORE this run's
 * own join attempt — `recordTierBlockedJoin`'s (`@/league-service/join`) own dedupe is per
 * (user, league), so a rerun against the same long-lived database never writes a second one, and
 * whether THIS run's own click created the notice or found it already there decides which proof
 * is fair to ask for below (`assertTierBlockedNoticeRecorded`'s own docblock).
 */
async function hasExistingTierBlockedNotice(leagueId: string): Promise<boolean> {
  const db = createDb();
  try {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, MANAGER_A_EMAIL));
    if (user === undefined) return false;
    const [existing] = await db
      .select({ id: memberNotices.id })
      .from(memberNotices)
      .where(and(eq(memberNotices.userId, user.id), eq(memberNotices.leagueId, leagueId), eq(memberNotices.noticeType, "tier_blocked_join")))
      .limit(1);
    return existing !== undefined;
  } finally {
    await db.$client.end();
  }
}

/**
 * The durable twin of `expectNotice`, for a `tier_blocked_join` notice this run's own refusal did
 * NOT freshly create. Same reasoning as `assertHeldTradeNoticeRecorded` below: a notice deduped
 * per (user, league) is written once, ever, and ages further behind manager A's own inbox page
 * every additional run any OTHER spec makes against this shared identity on this long-lived
 * database — checking the notices PANEL for it would eventually test pagination, not the refusal.
 */
async function assertTierBlockedNoticeRecorded(leagueId: string): Promise<void> {
  const db = createDb();
  try {
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, MANAGER_A_EMAIL));
    if (user === undefined) throw new Error(`[e2e] assertTierBlockedNoticeRecorded: manager A ("${MANAGER_A_EMAIL}") not found.`);
    const [notice] = await db
      .select({ title: memberNotices.title })
      .from(memberNotices)
      .where(and(eq(memberNotices.userId, user.id), eq(memberNotices.leagueId, leagueId), eq(memberNotices.noticeType, "tier_blocked_join")))
      .orderBy(desc(memberNotices.createdAt))
      .limit(1);
    if (notice === undefined) throw new Error("[e2e] assertTierBlockedNoticeRecorded: no tier_blocked_join notice on record for manager A.");
    if (notice.title !== "That league is reserved for newer players") {
      throw new Error(`[e2e] assertTierBlockedNoticeRecorded: unexpected title "${notice.title}".`);
    }
  } finally {
    await db.$client.end();
  }
}

/**
 * Phase 3 Plan D, Task 10, Step 3: the three journeys a screenshot cannot fake, walked in a real
 * browser against the real production build — no dev auth bypass anywhere (`global-setup.ts`'s
 * own sealed WorkOS sessions, or a genuinely storageless context for the one page a signed-out
 * visitor reaches). Its own two leagues (`ensureHeldTradeLeague`, `ensureDraftScheduleLeague`,
 * both `global-setup.ts`) follow the reuse-if-exists, stable-identity pattern Plan B and Plan C
 * both settled on: this spec seeds what IT needs, never extends `trades.spec.ts`'s or
 * `league-lifecycle.spec.ts`'s own leagues, and a rerun against the same database never
 * accumulates a second one of either.
 *
 * RUN ORDER (binding context): Playwright discovers spec files alphabetically under this suite's
 * single worker (`playwright.config.ts`'s own `workers: 1`), and "enforcement" sorts before
 * every other file in `e2e/`. That means this spec's own held trade — the SECOND `trade_hold`
 * flag the operator queue holds this run, after `npm run seed`'s own (`seed-enforcement.ts`,
 * `dev_public_trade_hold`) — is already in the queue by the time `league-lifecycle.spec.ts` and
 * `mobile-360.spec.ts` run their own open-flag counts; both files' counts are updated sharply to
 * account for it (see each file's own updated docblock).
 */

test("a veteran browses, is refused a beginner league, and reads why", async ({ managerA }) => {
  const target = DEV_SEED.publicLeagues.find((plan) => plan.leagueId === "dev_public_tier_demo")!;
  const noticeAlreadyExisted = await hasExistingTierBlockedNotice(target.leagueId);
  await managerA.goto("/browse");
  await expect(managerA.getByRole("heading", { name: "Open leagues" })).toBeVisible();

  // Sees the tier filter — Task 2's own "who's playing" axis.
  await expect(managerA.getByLabel("Who's playing")).toBeVisible();

  // The target beginner league, already visible in the unfiltered default listing, carrying the
  // composition label a real query computed SERVER-side (final review F6 moved the reduction off
  // the client, so this text is the bucket the wire actually carried).
  //
  // "MOSTLY NEWCOMERS", AND DURABLY SO (Phase 3.5, Task 7.5 — the ledgered aging class' third
  // occurrence, root-caused rather than patched a fourth time). This used to read "All
  // newcomers", then briefly "Mostly newcomers" on the theory that `dev_user_04` — one of the
  // shared 12-identity dev pool `ensureDevUsers` hands every seeder — had genuinely crossed
  // `INTEGRITY_CONFIG.participation.veteranSeasonCutoff`. That theory held for exactly as long as
  // no OTHER shared-pool identity crossed it too: `stampSeasonCompleteInTx`
  // (`@/league-service/participation`) stamps ANY league's season complete the moment its last
  // matchup scores, with no notion of which leagues were only ever meant to demo a lineup lock,
  // and every identity in the shared pool sits in at least one league (`dev_league_snake`) whose
  // scheduled draft eventually gets started and autopicked by the same ticker every e2e run's dev
  // server keeps live. `dev_user_02` and `dev_user_03` crossed the cutoff next, on a run this
  // spec's own author found failing locally, and patching the expected label a third time would
  // only have bought another few runs before a fourth identity aged out from under it.
  //
  // The durable fix is `seedTierDemoIdentities` (`src/data/seed/seed-tier-demo.ts`): this
  // league's three seats are no longer members of the shared pool at all. Two are dedicated
  // identities no other seeder ever lists, so they can never accumulate a completed season; the
  // third already has three REAL completed seasons the moment `npm run seed` finishes, scored at
  // birth through the identical `seedSeasonLeague` path manager A's own veteran status uses, with
  // no unscored matchup left for any later ticker to find. "Mostly newcomers" is therefore true by
  // construction on every run, not merely true today — see that module's own docblock for the
  // full incident.
  const card = managerA.locator("li").filter({ has: managerA.getByRole("heading", { name: target.name }) });
  await expect(card).toBeVisible();
  await expect(card.getByText("Mostly newcomers")).toBeVisible();

  // Manager A is the platform's own real veteran: three REAL completed seasons, stamped by
  // `finalizeWeekInTx` itself (`npm run seed`'s own `VETERAN_SEASON_LEAGUES` loop). Pressing
  // Join here is the real `publicJoinPrecondition` gate, never a synthesized refusal.
  await card.getByRole("button", { name: `Join ${target.name}` }).click();
  await expect(card.getByText(ENFORCEMENT_REFUSALS.join)).toBeVisible();

  // The real notice the refused join raised — `tier_blocked_join`, deduped per (user, league)
  // (`recordTierBlockedJoin`'s own dedupe) so a rerun of this very spec against the same database
  // never writes a second one. The notices PANEL is only a fair check the FIRST time this pair is
  // ever refused (this run's own click is what created the row, so it is by definition the
  // newest thing in the inbox); on every later run the row already existed before this test even
  // opened a browser, and manager A's own inbox has kept moving since — read it directly instead,
  // the same durable-over-paginated proof `assertHeldTradeNoticeRecorded` uses below.
  if (noticeAlreadyExisted) {
    await assertTierBlockedNoticeRecorded(target.leagueId);
  } else {
    await expectNotice(managerA, "That league is reserved for newer players");
  }
});

test("a commissioner schedules and starts a draft; a signed-out visitor reads the new time first", async ({ browser }) => {
  test.setTimeout(60_000);

  const invite: DraftScheduleInvite = JSON.parse(readFileSync(E2E_DRAFT_SCHEDULE_INVITE_STATE, "utf8")) as DraftScheduleInvite;
  const contextA = await browser.newContext({ storageState: MANAGER_A_STATE });
  // Genuinely signed out — no storage state at all, the one shape `middleware.ts` exempts
  // (`/app/join/[code]`'s own docblock). Never `MANAGER_B_STATE`: using a real identity here
  // would defeat the point of a SIGNED-OUT read.
  const anonContext = await browser.newContext();
  const pageA = await contextA.newPage();
  const anonPage = await anonContext.newPage();

  try {
    // `ensureDraftScheduleLeague` (`global-setup.ts`) wipes and recreates this league from
    // nothing on every setup run — scheduled, never started — so there is no "did a prior run
    // already walk this journey" branch to detect here any more. Interstitial repair, Phase 3.5
    // Task 1.5: the old two-branch shape assumed a started draft stayed `in_progress` forever,
    // which stopped being true once the same autopick/nudge machinery every other draft gets
    // carried this one all the way to `complete` and stats:ingest scored a season on top of it,
    // between suite runs, on a long-lived dev database — see that function's own docblock.
    await pageA.goto(`/app/leagues/${E2E_DRAFT_SCHEDULE_LEAGUE_ID}`);
    await expect(pageA.getByRole("heading", { name: "E2E Draft Schedule League" })).toBeVisible();

    // --- The commissioner sets a real draft time, five days out (past the "starting soon"
    // banner, which this journey has no need to also prove) ----------------------------------
    const kickoff = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const pad = (n: number): string => String(n).padStart(2, "0");
    const localValue = `${kickoff.getFullYear()}-${pad(kickoff.getMonth() + 1)}-${pad(kickoff.getDate())}T${pad(kickoff.getHours())}:${pad(kickoff.getMinutes())}`;

    await pageA.getByRole("button", { name: "Edit time" }).click();
    await pageA.getByLabel("Draft time").fill(localValue);
    await pageA.getByRole("button", { name: "Save time" }).click();
    await expect(pageA.getByRole("heading", { name: "Draft scheduled" })).toBeVisible();

    // --- A signed-out visitor reads the NEW time on the invite preview — never sees it from
    // the commissioner's own session, and never through a dev auth bypass ------------------
    const expectedAbsolute = formatDraftTime(kickoff.toISOString(), new Date().toISOString()).split(" (")[0]!;
    await anonPage.goto(`/app/join/${invite.code}`);
    await expect(anonPage.getByRole("heading", { name: "E2E Draft Schedule League" })).toBeVisible();
    await expect(anonPage.getByText(expectedAbsolute)).toBeVisible();
    // The one page under `/app` a signed-out visitor reaches — proven structurally, not just
    // by the page rendering: the sign-in prompt is what a stranger sees instead of a join
    // button that would silently assume an identity nobody supplied.
    await expect(anonPage.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();

    // --- The commissioner presses Start the draft — the first time any browser in this
    // product's history has called `POST /api/drafts/[draftId]/start` ------------------------
    await pageA.getByRole("button", { name: "Start the draft" }).click();
    await expect(pageA.getByRole("heading", { name: "The draft is live" })).toBeVisible({ timeout: 15_000 });
  } finally {
    await contextA.close();
    await anonContext.close();
  }
});

/**
 * Resume-safety AND idempotency, both from one read: a prior run that crashed between propose
 * and accept leaves an OPEN offer between these two teams (which would collide on
 * `proposeTrade`'s own open-fingerprint index and refuse this run's otherwise-identical offer
 * with a 409) — cleared here, the identical class `trades.spec.ts`'s own `clearStrayState`
 * guards against. A prior run that COMPLETED, though, already put a real `held` trade between
 * these two teams — `proposeTrade`'s fingerprint index is partial on `status = 'open'`
 * (`trade_proposals_open_fingerprint_idx`), so it does NOT block a second, byte-identical
 * proposal once the first has moved past `open`. Without this check, every re-run of this spec
 * against the same long-lived database would propose and hold ANOTHER trade, growing the
 * operator queue's own `trade_hold` count by one per run — exactly the class of fragility Task
 * 10's own brief ledgers (`league-lifecycle.spec.ts`'s and `mobile-360.spec.ts`'s own sharp
 * counts would need bumping forever). Reusing the first one found is what keeps this spec's own
 * footprint at exactly one held trade, however many times it runs.
 */
async function findExistingHeldTradeId(): Promise<string | null> {
  const db = createDb();
  try {
    await db.delete(tradeProposals).where(and(eq(tradeProposals.leagueId, E2E_HELD_TRADE_LEAGUE_ID), eq(tradeProposals.status, "open")));
    const [existing] = await db.select({ id: tradeProposals.id }).from(tradeProposals).where(and(eq(tradeProposals.leagueId, E2E_HELD_TRADE_LEAGUE_ID), eq(tradeProposals.status, "held"))).limit(1);
    return existing?.id ?? null;
  } finally {
    await db.$client.end();
  }
}

/**
 * The durable twin of `expectNotice`, for the REUSE branch alone. `INTEGRITY_CONFIG.notices
 * .inboxSize` bounds the notices panel at 20 — a deliberate, documented cap
 * (`docs/decisions/audit-and-integrity.md`'s own residual), not a bug — and this spec's own held
 * trade is reused FOREVER once created (this function's own docblock above), which means its
 * ONE `trade_held_for_review` notice ages further behind manager B's inbox page every additional
 * run any spec makes against this long-lived database. `expectNotice`'s UI-panel check is the
 * right proof the FIRST time this trade is ever held (the fresh-propose branch below, where the
 * notice is by definition the newest thing in the inbox) — it stops being a fair test of the
 * PRODUCT once repeated runs have pushed the row past page one, and would then be testing inbox
 * pagination, not this feature. Reads the stored, already-rendered row directly instead — the
 * same durable, title/body-stored shape `NOTICE_TEMPLATES` renders into on write, never
 * re-rendered here.
 */
async function assertHeldTradeNoticeRecorded(): Promise<void> {
  const db = createDb();
  try {
    const [team] = await db.select({ userId: teams.userId }).from(teams).where(eq(teams.id, E2E_HELD_TRADE_TEAM_B_ID));
    if (team === undefined) throw new Error(`[e2e] assertHeldTradeNoticeRecorded: team "${E2E_HELD_TRADE_TEAM_B_ID}" not found.`);
    const [notice] = await db
      .select({ title: memberNotices.title })
      .from(memberNotices)
      .where(and(eq(memberNotices.userId, team.userId), eq(memberNotices.leagueId, E2E_HELD_TRADE_LEAGUE_ID), eq(memberNotices.noticeType, "trade_held_for_review")))
      .orderBy(desc(memberNotices.createdAt))
      .limit(1);
    if (notice === undefined) throw new Error("[e2e] assertHeldTradeNoticeRecorded: no trade_held_for_review notice on record for manager B.");
    if (notice.title !== "Your trade is waiting on a fairness review") {
      throw new Error(`[e2e] assertHeldTradeNoticeRecorded: unexpected title "${notice.title}".`);
    }
  } finally {
    await db.$client.end();
  }
}

test("a trade past the auto-hold threshold really holds, and the counterparty reads the same sentence the notice sent them", async ({ browser }) => {
  test.setTimeout(60_000);

  const fixture: HeldTradeFixture = JSON.parse(readFileSync(E2E_HELD_TRADE_FIXTURE_STATE, "utf8")) as HeldTradeFixture;
  const contextA = await browser.newContext({ storageState: MANAGER_A_STATE });
  const contextB = await browser.newContext({ storageState: MANAGER_B_STATE });
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  try {
    const existingHeldTradeId = await findExistingHeldTradeId();

    if (existingHeldTradeId === null) {
      // --- Manager A proposes the widest-gap package `global-setup.ts` computed, in a real
      // browser — well past `INTEGRITY_CONFIG.trade.autoHoldThreshold` -------------------------
      await pageA.goto(`/app/leagues/${E2E_HELD_TRADE_LEAGUE_ID}/trades`);
      await expect(pageA.getByRole("heading", { name: "Trades" })).toBeVisible();
      await pageA.getByRole("button", { name: "Put an offer together" }).click();
      await pageA.getByLabel("Trade with").selectOption({ label: "E2E Held Trade Team 2" });

      const myFieldset = pageA.locator("fieldset").filter({ hasText: "Your players" });
      const theirFieldset = pageA.locator("fieldset").filter({ hasText: "Their players" });
      for (const name of fixture.giveNames) await myFieldset.locator("li").filter({ hasText: name }).getByRole("checkbox").check();
      for (const name of fixture.getNames) await theirFieldset.locator("li").filter({ hasText: name }).getByRole("checkbox").check();

      await pageA.getByRole("button", { name: "Propose trade" }).click();
      await expect(pageA.getByText("Trade proposed.")).toBeVisible();

      // --- Manager B accepts — and this one holds instead of executing ------------------------
      await pageB.goto(`/app/leagues/${E2E_HELD_TRADE_LEAGUE_ID}/trades`);
      const inboundCard = pageB.getByRole("region", { name: "Offers to answer" }).getByRole("article", { name: "Trade with E2E Held Trade Team 1" });
      await expect(inboundCard).toBeVisible();
      await inboundCard.getByRole("button", { name: "Accept" }).click();
      await pageB.getByRole("button", { name: "Confirm trade" }).click();
    } else {
      // A prior run already held this pair's own trade for real — read it, never re-propose it.
      await pageB.goto(`/app/leagues/${E2E_HELD_TRADE_LEAGUE_ID}/trades`);
    }

    // --- Manager B's own page, still open, now shows the held trade — never "Both rosters
    // changed": nothing moved, the fairness review is what is happening instead --------------
    const heldCard = pageB.getByRole("region", { name: "Trade history" }).getByRole("article", { name: "Trade with E2E Held Trade Team 1" }).first();
    await expect(heldCard).toBeVisible({ timeout: 15_000 });
    await expect(heldCard.getByText("Your trade is waiting on a fairness review")).toBeVisible();
    const bannerSentence =
      "Your trade with E2E Held Trade Team 1 in E2E Held Trade League is on hold while somebody at Commish looks at it. Public leagues get a second pair of eyes on trades this lopsided, and neither roster changes until that finishes. We will tell you both as soon as there is an answer.";
    await expect(heldCard.getByText(bannerSentence)).toBeVisible();
    await expect(heldCard.getByText("Both rosters changed when this trade was accepted.")).toHaveCount(0);

    // --- The SAME sentence the real notice sent — proven byte-identical, not merely similar.
    // Only the FRESH branch checks the notices PANEL: the reuse branch's own trade can be
    // arbitrarily old by now (`assertHeldTradeNoticeRecorded`'s own docblock), so it reads the
    // stored, already-rendered row directly — durable proof the notice was really sent, without
    // depending on it still sitting on the inbox's bounded first page. -------------------------
    if (existingHeldTradeId === null) {
      await expectNotice(pageB, "Your trade is waiting on a fairness review");
    } else {
      await assertHeldTradeNoticeRecorded();
    }
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
