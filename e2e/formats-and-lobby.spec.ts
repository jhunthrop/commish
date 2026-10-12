import { eq } from "drizzle-orm";
import { createDb, type Db } from "@research-ts/db/client";
import { drafts, leagues, scoringSettings, teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@research-ts/domain/roster";
import { HALF_PPR_SCORING } from "@research-ts/domain/scoring";
import { ensureDevUsers } from "../src/data/seed/dev-users";
import { isSafeToKeepFillingHouseLeague, staleHouseShelfMessage } from "../src/data/seed/house-fill-safety";
import { openHouseLeaguesQuery } from "../src/league-service/house-factory";
import { joinPublicLeague } from "../src/league-service/join";
import { MEDIAN_DEMO_LEAGUE } from "../src/data/seed/seed-season-league";
import { expect, SEEDED_SEASON_LEAGUE_ID, test } from "./support/fixtures";

/**
 * Phase 3.5, Task 10, Step 3: the three journeys a screenshot cannot fake — a manager ranking
 * draft slots and the draft starting in an order consistent with that ranking; a sit-and-go
 * league's last seat taken live, with a second, independent session watching its own waiting
 * room pick up the countdown; and a settled median week's second result reaching both the
 * matchup page and the standings. Every assertion below is either a real navigation against a
 * receipt only the hydrated page produces, or a relative/derived count — never an absolute one a
 * seed change elsewhere in this suite could quietly invalidate.
 */

// -------------------------------------------------------------------------------------------
// Journey 1's own fixture: a scheduled, never-started, two-team league, wiped and rebuilt on
// every run — the identical `ensureDraftScheduleLeague` idiom `e2e/global-setup.ts` already uses
// for the same class of hazard: a draft THIS journey itself starts must never be found already
// started or completed by a later rerun (Task 6's preference window closes at the draw). Team
// A's owner is manager A, resolved from the SAME seeded season league every other spec already
// reads back rather than re-derived (`SEEDED_SEASON_LEAGUE_ID`'s own team 1 — the identical
// "read the real row, never re-derive" discipline `src/data/seed/index.ts`'s own tier-block
// section follows). Team B is a disposable placeholder that never opens a browser.
//
// `E2E_SLOT_PREF_DRAFT_ID` is not arbitrary: `drawSequenceFor` (`@/draft-service/order`) draws a
// deterministic order from the draft's own id, and this literal id was chosen (offline, against
// the real function) so team A draws FIRST — which is what makes "rank slot 2 first" a
// GUARANTEED top-choice outcome rather than a coin flip on whichever team the draw favors.
// -------------------------------------------------------------------------------------------

const E2E_SLOT_PREF_LEAGUE_ID = "e2e_formats_slot_pref_league";
const E2E_SLOT_PREF_DRAFT_ID = "e2e_formats_slot_pref_draft_1";
const E2E_SLOT_PREF_TEAM_A_ID = "e2e_formats_slot_pref_team_a";
const E2E_SLOT_PREF_TEAM_B_ID = "e2e_formats_slot_pref_team_b";
const E2E_SLOT_PREF_FILLER_ID = "e2e_formats_slot_pref_filler";

async function resolveManagerAUserId(db: Db): Promise<string> {
  const [team1] = await db.select({ userId: teams.userId }).from(teams).where(eq(teams.id, `${SEEDED_SEASON_LEAGUE_ID}_team_01`));
  if (team1 === undefined) throw new Error(`[e2e] formats-and-lobby: ${SEEDED_SEASON_LEAGUE_ID}_team_01 doesn't resolve — has global setup run?`);
  return team1.userId;
}

async function ensureSlotPreferenceLeague(db: Db, managerAUserId: string): Promise<void> {
  // Cascades away any prior run's own draft (actions, picks, the preference row) along with the
  // league row itself — the same full wipe `ensureDraftScheduleLeague` performs and for the
  // identical reason (see this file's own docblock above).
  await db.delete(leagues).where(eq(leagues.id, E2E_SLOT_PREF_LEAGUE_ID));

  await db
    .insert(users)
    .values({ id: E2E_SLOT_PREF_FILLER_ID, email: `${E2E_SLOT_PREF_FILLER_ID}@commish-lab.test`, displayName: "Slot Pref Filler" })
    .onConflictDoNothing({ target: users.id });

  await db.insert(leagues).values({
    id: E2E_SLOT_PREF_LEAGUE_ID,
    name: "E2E Slot Preference League",
    format: "snake",
    teamCount: 2,
    isPublicMatchmade: false,
    commissionerUserId: managerAUserId,
    rosterSlots: [...STANDARD_ROSTER_SLOTS],
  });
  await db.insert(scoringSettings).values({ leagueId: E2E_SLOT_PREF_LEAGUE_ID, ...HALF_PPR_SCORING });
  await db.insert(teams).values([
    { id: E2E_SLOT_PREF_TEAM_A_ID, leagueId: E2E_SLOT_PREF_LEAGUE_ID, userId: managerAUserId, name: "Slot Pref Team A" },
    { id: E2E_SLOT_PREF_TEAM_B_ID, leagueId: E2E_SLOT_PREF_LEAGUE_ID, userId: E2E_SLOT_PREF_FILLER_ID, name: "Slot Pref Team B" },
  ]);
  const kickoffAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  await db
    .insert(drafts)
    .values({ id: E2E_SLOT_PREF_DRAFT_ID, leagueId: E2E_SLOT_PREF_LEAGUE_ID, format: "snake", status: "scheduled", kickoffAt, auctionBudget: null });
}

// -------------------------------------------------------------------------------------------
// Journey 2's own fixture. The league itself is created through the REAL create-league UI, in
// the test body below — this section only names the small backstage helper that seats the
// MIDDLE seats through the real `joinPublicLeague` transaction (dev placeholder identities, the
// same "a bystander seat is real service, never a raw insert" discipline `src/data/seed/index.ts`
// keeps for its own tier-block demonstration), so the LAST seat — the one that actually proves
// the fill trigger — is left for manager B's own real click.
// -------------------------------------------------------------------------------------------

/** How many of the smallest UI team-count option's (8) seats to fill backstage before manager B
 *  takes the last one live: commissioner (1) + 6 backstage joins = 7, one seat left. */
const BACKSTAGE_FILL_COUNT = 6;

async function fillAllButOneSeat(db: Db, leagueId: string): Promise<void> {
  const owners = await ensureDevUsers(db);
  for (let i = 1; i <= BACKSTAGE_FILL_COUNT; i++) {
    const outcome = await joinPublicLeague({ db, newId: () => crypto.randomUUID(), clock: { now: () => new Date().toISOString() } }, { leagueId, userId: owners[i]! });
    if (!outcome.ok) throw new Error(`[e2e] formats-and-lobby: backstage join ${i} for ${leagueId} was refused: ${outcome.reason}`);
  }
}

// -------------------------------------------------------------------------------------------
// Journey 4's own fixture (Phase 3.5 addendum, Task 15, Step 2): the house shelf's own reconciler,
// proven from a browser rather than only from `npm run seed`. `src/data/seed/index.ts`'s own
// house arc (Task 15, Step 1) already ran during global setup and left `open_12`'s shelf at its
// own `openAtOnce` width — this journey borrows the SHELF'S OWN oldest SAFE still-open league
// (never a hardcoded edition, the same "creation order, not a guessed id" discipline that seed
// arc keeps) and fills every seat but one BACKSTAGE, through the real `joinPublicLeague`
// transaction — the identical "a bystander seat is real service, never a raw insert" shape
// `fillAllButOneSeat` above already keeps for the sit-and-go journey. Dedicated, e2e-only filler
// identities: `open_12` gates on nothing (`tierJoinPrecondition` only ever blocks a
// `beginner`-tier league), so this never needs the dev pool's own veteran-avoidance discipline,
// but a dedicated pool still keeps this journey from ever touching a seat another spec depends on.
//
// Fix round 1, F1: "oldest STILL-OPEN" is not automatically SAFE — on a long-lived shared dev
// database, `open_12`'s earliest still-open league can carry a fixed kickoff (the `'when_full'`
// placeholder `kickoffFor` wrote at spawn time, `@/league-service/house-factory.ts` — founder
// directive 2026-08-26 made every house rung `'when_full'`, so this is the only kickoff a house
// league ever gets until it fills) that has already aged past "now". Backstage-filling one of
// those to two-plus seats would arm `autoStartDueDrafts`
// (no fill-completeness requirement of its own — `@/draft-service/auto-start`) and race the real
// ticker for whether the live last-seat click below lands before the draft does — an intermittent
// `DRAFT_ALREADY_STARTED` flake unrelated to the shelf behavior this journey actually tests.
// `resolveOpenHouseLeague` walks every still-open candidate oldest-first and picks the first with
// a comfortably-future kickoff, sharing the exact predicate `src/data/seed/index.ts`'s own
// `resolveSafeFillTarget` uses (`../src/data/seed/house-fill-safety.ts`) rather than a second,
// hand-typed copy of the same margin.
// -------------------------------------------------------------------------------------------

const HOUSE_JOIN_FILLER_ID_PREFIX = "e2e_house_filler_";

/** The shelf's own oldest still-open, SAFE-to-fill `open_12` league — `openHouseLeaguesQuery`,
 *  the EXACT query `ensureHouseCatalog` itself counts by, never a hand-copied re-derivation of
 *  "still open". Every row it returns is already short of capacity (that query's own `having`
 *  clause), so — unlike the seed's own `resolveSafeFillTarget` — there is no "already full, safe
 *  regardless of kickoff" shortcut here: each candidate is checked on its kickoff alone. */
async function resolveOpenHouseLeague(db: Db, clock: { readonly now: () => string }): Promise<{ readonly id: string; readonly name: string; readonly teamCount: number; readonly filled: number }> {
  const rows = await openHouseLeaguesQuery(db, "open_12", clock.now());
  if (rows.length === 0) {
    throw new Error("[e2e] formats-and-lobby: no open open_12 house league found — has the shelf's own reconciler run yet?");
  }
  for (const row of rows) {
    const [draftRow] = await db.select({ kickoffAt: drafts.kickoffAt }).from(drafts).where(eq(drafts.leagueId, row.id));
    if (draftRow === undefined || !isSafeToKeepFillingHouseLeague(draftRow.kickoffAt, clock.now())) continue;
    const [league] = await db.select({ name: leagues.name, teamCount: leagues.teamCount }).from(leagues).where(eq(leagues.id, row.id));
    const seated = await db.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, row.id));
    return { id: row.id, name: league!.name, teamCount: league!.teamCount, filled: seated.length };
  }
  throw new Error(staleHouseShelfMessage("open_12", "[e2e] formats-and-lobby"));
}

/** Fills every seat but one, through the real join transaction — the last seat is left for the
 *  live browser click this journey actually tests. */
async function fillHouseLeagueAllButOneSeat(db: Db, leagueId: string, seatsToFill: number): Promise<void> {
  const fillerIds = Array.from({ length: seatsToFill }, (_, i) => `${HOUSE_JOIN_FILLER_ID_PREFIX}${String(i + 1).padStart(2, "0")}`);
  if (fillerIds.length === 0) return;
  await db
    .insert(users)
    .values(fillerIds.map((id) => ({ id, email: `${id}@commish-lab.test`, displayName: `House Filler ${id.slice(-2)}` })))
    .onConflictDoNothing({ target: users.id });
  for (const userId of fillerIds) {
    const outcome = await joinPublicLeague({ db, newId: () => crypto.randomUUID(), clock: { now: () => new Date().toISOString() } }, { leagueId, userId });
    if (!outcome.ok) throw new Error(`[e2e] formats-and-lobby: house backstage join for ${userId} against ${leagueId} was refused: ${outcome.reason}`);
  }
}

// -------------------------------------------------------------------------------------------

test.describe("formats and lobby", () => {
  test.beforeAll(async () => {
    const db = createDb();
    try {
      const managerAUserId = await resolveManagerAUserId(db);
      await ensureSlotPreferenceLeague(db, managerAUserId);
    } finally {
      await db.$client.end();
    }
  });

  test("a manager ranks two draft slots and the draft starts in an order consistent with the ranking", async ({ managerA }) => {
    await managerA.goto(`/app/leagues/${E2E_SLOT_PREF_LEAGUE_ID}`);
    await expect(managerA.getByRole("heading", { name: "E2E Slot Preference League" })).toBeVisible();

    // Rank slot 2 first, slot 1 second — real, named buttons, never a drag gesture. Click-and-
    // verify, RETRIED (discipline (a)): the panel now hydrates inside the waiting room's
    // checklist (Task 9's restructure), so an eager click can land pre-hydration as a silent
    // no-op; each rank click re-fires until its own receipt (the ranked tile) appears.
    await expect(async () => {
      const ranked2 = managerA.locator('[aria-label="Your ranked slots"]').getByRole("listitem").filter({ hasText: "Slot 2" });
      if (!(await ranked2.isVisible())) await managerA.getByRole("button", { name: "Add slot 2 to your ranking" }).click();
      await expect(ranked2).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(async () => {
      const ranked1 = managerA.locator('[aria-label="Your ranked slots"]').getByRole("listitem").filter({ hasText: "Slot 1" });
      if (!(await ranked1.isVisible())) await managerA.getByRole("button", { name: "Add slot 1 to your ranking" }).click();
      await expect(ranked1).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    await managerA.getByRole("button", { name: "Save ranking" }).click();
    await expect(managerA.getByText("Saved. You ranked: 2, then 1.")).toBeVisible();

    // The commissioner's own press — the real `POST /api/drafts/[draftId]/start` route, exactly
    // `league-lifecycle.spec.ts`'s own "Start the draft" journey.
    await managerA.getByRole("button", { name: "Start the draft" }).click();
    // Scoped to `main` (Task 2's shell): the rail's own crest for every needs-you league on this
    // account also carries "Join the draft" as a substring of its accessible name (Step 1's own
    // requirement), so on an account with more than one such league the bare locator matches
    // more than this page's own link.
    await expect(managerA.locator("main").getByRole("link", { name: "Join the draft" })).toBeVisible();

    // The panel's own initial props are seeded once, server-side, and starting the draft never
    // pushes a fresh `assignedSlot` down to it — a reload is what re-fetches the now-drawn
    // result, retried the same way every other post-write reload in this suite is.
    await expect(async () => {
      await managerA.reload();
      await expect(managerA.getByText("You ranked slot 2 first and you got slot 2.")).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  });

  test("a sit-and-go league's last seat is taken in one session and the other session's waiting room shows the countdown", async ({ managerA, managerB }) => {
    test.setTimeout(120_000);
    const leagueName = `E2E Sit-and-Go ${Date.now()}`;

    // --- Create, through the real UI: public, when_full, the smallest team count ------------
    await managerA.goto("/app");
    // Manager A already has several seeded leagues by this point in the suite, so the create
    // form is collapsed behind Task 5's disclosure — the identical opening move
    // `league-lifecycle.spec.ts`'s own create journey makes.
    await managerA.getByText("Start or join another league").click();
    await managerA.getByLabel("League name", { exact: true }).fill(leagueName);
    await managerA.getByLabel("Who can join").selectOption("public");
    await managerA.getByText(/Advanced settings/).click();
    await managerA.getByLabel("Teams").selectOption("8");
    await managerA.getByLabel("Draft start").selectOption("when_full");
    await managerA.getByRole("button", { name: "Create league" }).click();

    await expect(managerA.getByRole("heading", { name: leagueName })).toBeVisible();
    const leagueId = new URL(managerA.url()).pathname.split("/").pop()!;
    expect(leagueId).toBeTruthy();

    // The filling state, and the create form's own "Starts as soon as it fills" choice showing
    // up as a real fact about this league, not only as a selected option.
    // Phase 3.6, Task 9 (F17): the seat sentence is `SeatMeter`'s own composed span now, not a
    // heading this page wrote itself — "1 of 8 seats taken" is retired everywhere. Scoped to
    // `waiting-room-hero`: `RoomRoster`, below the hero, renders the identical sentence off the
    // SAME `SeatMeter` primitive (F17), so the bare text alone matches twice on this page.
    await expect(managerA.getByTestId("waiting-room-hero").getByText("1 of 8 seated")).toBeVisible();
    // e2e checkpoint (P9-P11): `exact: true` — Task 11's dense header line also composes this
    // exact phrase into a longer sentence ("0-0 · #1 seed · Starts as soon as it fills · ..."),
    // so the substring match now resolves to both the terms panel's own `<dd>` (the fact this
    // assertion means to check) and that unrelated composed line.
    await expect(managerA.getByText("Starts as soon as it fills", { exact: true })).toBeVisible();

    // --- Backstage: fill every seat but the last, through the real join transaction ---------
    const db = createDb();
    try {
      await fillAllButOneSeat(db, leagueId);
    } finally {
      await db.$client.end();
    }

    // --- The LAST seat, live, through the real UI -------------------------------------------
    await managerB.goto("/browse");
    await managerB.getByRole("button", { name: `Join ${leagueName}` }).click();
    await expect(managerB).toHaveURL(new RegExp(`/app/leagues/${leagueId}$`));
    // Phase 3.6, Task 9 (D3): "All N seats are full." was a `StatePanel` heading this task
    // retired outright — the full room's own hero now settles the SAME `SeatMeter` sentence to
    // "N of N seated" (no heading at all) before the `xl` `Countdown` beside it. Scoped to
    // `waiting-room-hero` for the same reason as the filling-state assertion above.
    await expect(managerB.getByTestId("waiting-room-hero").getByText("8 of 8 seated")).toBeVisible();
    await expect(managerB.getByTestId("waiting-room-countdown")).toBeVisible();

    // --- The OTHER session's own waiting room, retried against the real receipt ------------
    await expect(async () => {
      await managerA.reload();
      await expect(managerA.getByTestId("waiting-room-hero").getByText("8 of 8 seated")).toBeVisible({ timeout: 5_000 });
      await expect(managerA.getByTestId("waiting-room-countdown")).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
  });

  test("a settled median week shows a second result on the matchup page and a record in the standings that includes it", async ({ managerA }) => {
    const leagueId = MEDIAN_DEMO_LEAGUE.leagueId;

    await managerA.goto(`/app/leagues/${leagueId}/matchups/1`);
    // Scoped to manager A's OWN second-person line — the page renders one of these per team in
    // the week (4, for `MEDIAN_DEMO_LEAGUE`'s own four teams), and only one is ever "You".
    await expect(managerA.getByText(/^You scored .+ so you (won|lost|tied) that one too\./)).toBeVisible();

    await managerA.goto(`/app/leagues/${leagueId}`);
    await expect(managerA.getByText("Records include each week's median game.")).toBeVisible();

    const ownRow = managerA.locator('tr[data-own="true"]');
    await expect(ownRow).toBeVisible();
    const recordText = await ownRow.innerText();
    const match = /(\d+)-(\d+)(?:-(\d+))?/.exec(recordText);
    expect(match).not.toBeNull();
    const [, wins, losses, ties] = match!;
    const totalGames = Number(wins) + Number(losses) + Number(ties ?? "0");
    // A median league plays TWO games a week — this is the relative, page-derived proof: every
    // scored week contributes 2 to the total, never a hardcoded absolute count.
    expect(totalGames).toBeGreaterThan(0);
    expect(totalGames % 2).toBe(0);
  });

  test("a visitor takes the last open seat in a house league and the shelf shows a replacement", async ({ managerA, managerB }) => {
    test.setTimeout(120_000);

    // --- Backstage: leave exactly one seat open on the shelf's own oldest SAFE open_12 league ---
    const db = createDb();
    let target: { id: string; name: string; teamCount: number; filled: number };
    try {
      target = await resolveOpenHouseLeague(db, { now: () => new Date().toISOString() });
      await fillHouseLeagueAllButOneSeat(db, target.id, target.teamCount - target.filled - 1);
    } finally {
      await db.$client.end();
    }

    // --- BEFORE: the shelf shows this exact league, read from the hydrated page. Founder
    //     directive 2026-08-26 dropped `open_12`'s own shelf width to 1 and replaced its factory
    //     name with a fun, curated pool entry (`houseLeagueName`, `@/matchmaking/house-catalog`)
    //     — there is no longer a shared "Open 12-team League N" substring every open_12 heading
    //     carries for a regex to filter the shelf on, so the deltas below poll the database by
    //     the SAME query the reconciler itself counts by (`openHouseLeaguesQuery`) rather than
    //     scrape a pattern out of the page's own heading list. ---------------------------------
    await managerA.goto("/browse");
    await expect(managerA.getByRole("heading", { name: target.name })).toBeVisible();

    // --- THE LAST SEAT, live, through the real UI -----------------------------------------------
    await managerB.goto("/browse");
    await managerB.getByRole("button", { name: `Join ${target.name}` }).click();
    await expect(managerB).toHaveURL(new RegExp(`/app/leagues/${target.id}$`));
    // e2e checkpoint (P9-P11): `exact: true` — Task 9's just-seated moment (D1) renders its own
    // `<h2>"{name} · You're in"</h2>` alongside the page's real `<h1>{name}</h1>`, so the bare
    // substring match now resolves to both; `exact` keeps this the page's own heading, the one
    // this assertion has always meant to check.
    await expect(managerB.getByRole("heading", { name: target.name, exact: true })).toBeVisible();

    // --- IMMEDIATE DELTA: the filled league drops off the shelf — a real-time read, no ticker
    //     wait needed, because `houseShelfQuery` (`@/league-service/browse`) only ever lists a
    //     league `hasOpenSeat` still accepts. -------------------------------------------------
    // e2e checkpoint (Phase 3.7 fix round): `reload()` resolves on the document's load event,
    // which fires while the root `loading.tsx` skeleton (`AppShellSkeleton shape="public"`) is
    // still on screen — the dynamic page streams in after it. Anchoring on the page's own
    // hydrated `h1` first (`"Open leagues"`) before asking whether `target.name` is gone is what
    // keeps this from passing trivially against a still-loading shell.
    await expect(async () => {
      await managerA.reload();
      await expect(managerA.getByRole("heading", { name: "Open leagues" })).toBeVisible();
      expect(await managerA.getByRole("heading", { name: target.name }).count()).toBe(0);
    }).toPass({ timeout: 15_000 });

    // --- DELAYED DELTA: the reconciler's own next tick opens a real replacement — retried up to
    //     comfortably past `DRAFT_SERVICE_CONFIG.houseReconcileIntervalMs` (30s), the real ticker
    //     interval, never a synthesized "tick now" call. `open_12`'s own width is 1, so the exact
    //     replacement is read back by NAME straight off `openHouseLeaguesQuery` (the reconciler's
    //     own count) rather than guessed at from the page. -------------------------------------
    const replacementDb = createDb();
    try {
      await expect(async () => {
        const [open] = await openHouseLeaguesQuery(replacementDb, "open_12", new Date().toISOString());
        expect(open?.id).toBeDefined();
        expect(open!.id).not.toBe(target.id);
        const [replacement] = await replacementDb.select({ name: leagues.name }).from(leagues).where(eq(leagues.id, open!.id));
        expect(replacement?.name).toBeDefined();

        await managerA.reload();
        await expect(managerA.getByRole("heading", { name: "Open leagues" })).toBeVisible();
        await expect(managerA.getByRole("heading", { name: replacement!.name })).toBeVisible();
      }).toPass({ timeout: 45_000 });
    } finally {
      await replacementDb.$client.end();
    }
  });
});
