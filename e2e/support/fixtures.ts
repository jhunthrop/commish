import { test as base, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { type Db } from "../../src/db/client";
import { drafts, leagues, scoringSettings, teams, users } from "../../src/db/schema";
import { STANDARD_ROSTER_SLOTS } from "../../src/domain/roster";
import { STANDARD_SCORING } from "../../src/domain/scoring";
import { DEV_SEED } from "../../src/data/seed/config";
import { joinPublicLeague } from "../../src/league-service/join";
import { MANAGER_A_EMAIL, MANAGER_A_STATE, MANAGER_B_STATE, MANAGER_D_STATE, MANAGER_SIGNOUT_STATE, MANAGER_ZERO_STATE } from "../global-setup";

/**
 * Two signed-in managers in two INDEPENDENT browser contexts — separate cookie jars, separate
 * `EventSource` connections, separate everything. That independence is the point: a realtime
 * fan-out assertion made inside one context proves nothing, because a page can always see its
 * own optimistic update.
 *
 * `managerZero` is a third, stable identity `global-setup` mints and warms the same way, but the
 * seed script never claims and no spec ever joins or creates a league for — it stays at zero
 * leagues run over run, which is what `onboarding.spec.ts` needs to see Task 5's first-run fork
 * for real, rather than mocking `experienceTier`/`helpLevel`/league count the way the unit
 * suite does.
 *
 * `managerSignOut` is a fourth, whose whole job is to be signed out. Signing out revokes the
 * WorkOS session server-side, so using any of the three above would silently invalidate a
 * session the rest of the run is holding — see `global-setup.ts`'s own note.
 */
export const test = base.extend<{ managerA: Page; managerB: Page; managerZero: Page; managerSignOut: Page; managerD: Page }>({
  managerA: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: MANAGER_A_STATE, ...(process.env.E2E_COLOR_SCHEME === undefined ? {} : { colorScheme: process.env.E2E_COLOR_SCHEME as "dark" | "light" }) });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  managerB: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: MANAGER_B_STATE });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  managerZero: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: MANAGER_ZERO_STATE });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  managerSignOut: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: MANAGER_SIGNOUT_STATE });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  // Phase 3.6, Task 13: `design-v2.spec.ts`'s own keyboard walk — see `global-setup.ts`'s
  // docblock on `MANAGER_D_EMAIL` for why this is a dedicated sixth identity rather than one of
  // the four above.
  managerD: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: MANAGER_D_STATE });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export const expect = test.expect;

/** The already-played league `npm run seed` hands manager A the commissioner's chair in. */
export const SEEDED_SEASON_LEAGUE_ID = DEV_SEED.season.leagueId;

/**
 * Opens the header's notice inbox and waits for `text` to appear in it — real retries, through
 * the product's own real mechanism, never a click that only toggles visibility. Extracted from
 * `e2e/trades.spec.ts` (Phase 3 Plan C, Task 9) so `e2e/enforcement.spec.ts` (Phase 3 Plan D,
 * Task 10) reads the identical helper rather than a second, drifting copy — both specs share the
 * same real constraint this docblock states: `useNotices` fetches exactly once per page mount,
 * so a `toPass` that only re-clicks the bell against an already-failed mount fetch is retrying
 * the wrong thing forever, and `INTEGRITY_CONFIG.notices.rateLimit` (32 requests/60s, PER USER)
 * is real and shared across every spec's own page loads — a transient 429 here is a genuine,
 * expected shape this helper answers with the panel's own "Try again" button
 * (`NoticeInbox`'s `refetch()`), never a page reload that would cost this budget a second mount
 * fetch for nothing.
 */
export async function expectNotice(page: Page, text: string): Promise<void> {
  await page.getByRole("button", { name: /^Notices/ }).click();
  const region = page.getByRole("region", { name: "Notices" });
  await expect(region).toBeVisible({ timeout: 5_000 });
  await expect(async () => {
    const tryAgain = region.getByRole("button", { name: "Try again" });
    if (await tryAgain.isVisible().catch(() => false)) await tryAgain.click();
    await expect(region.getByText(text).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 45_000 });
  await page.keyboard.press("Escape");
}

// -------------------------------------------------------------------------------------------
// Phase 3.6, Task 13's own two room fixtures — shared between `mobile-360.spec.ts` and
// `design-v2.spec.ts` (the only two files that need either), because both files need BOTH a
// "nobody's claimed a seat yet" league (the hold interstitial) and a "manager A is seated,
// draft not started" league (the waiting room, and — once a caller presses Start — the draft
// room). Each caller supplies its OWN distinct ids, the same "a league only this test touches
// is cheaper to reason about" argument `auth.spec.ts`'s own hold journey already makes, so
// neither file's use of these ever collides with the other's, or with `enforcement.spec.ts`'s
// own unrelated `E2E_DRAFT_SCHEDULE_LEAGUE_ID` journey.
// -------------------------------------------------------------------------------------------

/** Manager A's real `users.id`, resolved by the one stable identifier this file exposes for it
 *  (`MANAGER_A_EMAIL`) — the identical lookup `auth.spec.ts`'s own hold journey has no need for
 *  (it never seats manager A), but this task's two-team room fixture does, since manager A has
 *  to be a real team owner in it, not merely a placeholder. */
export async function managerAUserId(db: Db): Promise<string> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, MANAGER_A_EMAIL));
  if (row === undefined) {
    throw new Error(`[e2e] manager A's user row was not found by email ${MANAGER_A_EMAIL} — global-setup must run before this helper.`);
  }
  return row.id;
}

export interface OpenHoldLeagueOpts {
  readonly leagueId: string;
  readonly commishId: string;
  readonly name: string;
}

/**
 * A dedicated public league with an open seat and NO teams yet — the identical shape
 * `auth.spec.ts`'s own (private) `ensureHoldJourneyLeague` already established for its own hold
 * journey, copied here (not imported: that helper is file-private, and this task's two callers
 * need their own distinct league ids so neither collides with that journey or with each other).
 * Wiped and rebuilt on every run, the same reason every other per-spec league fixture in this
 * suite is: no prior run's own state to reason about.
 */
export async function ensureOpenHoldLeague(db: Db, opts: OpenHoldLeagueOpts): Promise<void> {
  await db.delete(leagues).where(eq(leagues.id, opts.leagueId));
  await db
    .insert(users)
    .values({ id: opts.commishId, email: `${opts.commishId}@commish-lab.test`, displayName: "Hold Fixture Commish" })
    .onConflictDoNothing({ target: users.id });
  await db.insert(leagues).values({
    id: opts.leagueId,
    name: opts.name,
    format: "snake",
    teamCount: 12,
    isPublicMatchmade: true,
    commissionerUserId: opts.commishId,
    rosterSlots: [...STANDARD_ROSTER_SLOTS],
  });
  await db.insert(scoringSettings).values({ leagueId: opts.leagueId, ...STANDARD_SCORING });
  await db.insert(drafts).values({
    id: `${opts.leagueId}_draft`,
    leagueId: opts.leagueId,
    format: "snake",
    status: "scheduled",
    kickoffAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    auctionBudget: null,
  });
}

export interface RoomJourneyLeagueOpts {
  readonly leagueId: string;
  readonly draftId: string;
  readonly teamAId: string;
  readonly teamBId: string;
  readonly name: string;
}

/**
 * A dedicated, wiped-and-rebuilt two-team league — manager A's own real seat plus one
 * placeholder co-manager, a scheduled draft nobody has started — the same `ensureDraftScheduleLeague`
 * idiom `global-setup.ts` already uses for `enforcement.spec.ts`'s own journey. This league's one
 * job is to give a caller BOTH a waiting room (before `startDraftAndEnterRoom` below presses
 * Start) and a draft room (after): Task 13's 360px and axe batteries need both states from
 * manager A's own signed-in session, and reusing `enforcement.spec.ts`'s league would race that
 * file's own start-the-draft journey across this suite's file-ordering.
 */
export async function ensureRoomJourneyLeague(db: Db, opts: RoomJourneyLeagueOpts): Promise<void> {
  const commissionerUserId = await managerAUserId(db);
  const coManagerId = `${opts.teamBId}_owner`;

  await db.delete(leagues).where(eq(leagues.id, opts.leagueId));
  await db
    .insert(users)
    .values({ id: coManagerId, email: `${coManagerId}@commish-lab.test`, displayName: "Room Journey Co-Manager" })
    .onConflictDoNothing({ target: users.id });

  await db.insert(leagues).values({
    id: opts.leagueId,
    name: opts.name,
    format: "snake",
    teamCount: 2,
    isPublicMatchmade: false,
    commissionerUserId,
    rosterSlots: [...STANDARD_ROSTER_SLOTS],
  });
  await db.insert(scoringSettings).values({ leagueId: opts.leagueId, ...STANDARD_SCORING });
  await db.insert(teams).values([
    { id: opts.teamAId, leagueId: opts.leagueId, userId: commissionerUserId, name: `${opts.name} Team A` },
    { id: opts.teamBId, leagueId: opts.leagueId, userId: coManagerId, name: `${opts.name} Team B` },
  ]);
  await db.insert(drafts).values({
    id: opts.draftId,
    leagueId: opts.leagueId,
    format: "snake",
    status: "scheduled",
    kickoffAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    auctionBudget: null,
  });
}

/**
 * Manager A presses "Start the draft" on `leagueId` (its `WaitingRoom` must already be showing —
 * `ensureRoomJourneyLeague` above guarantees that on a fresh run) and follows the resulting
 * "Join the draft" link, landing in the room — the identical mechanism `league-lifecycle.spec.ts`
 * and `formats-and-lobby.spec.ts` each already drive through the real UI, extracted here because
 * Task 13 needs it twice more and neither of ITS files is that mechanism's own test.
 */
export async function startDraftAndEnterRoom(page: Page, leagueId: string): Promise<void> {
  await page.goto(`/app/leagues/${leagueId}`);
  await page.getByRole("button", { name: "Start the draft" }).click();
  const draftHref = await page.locator("main").getByRole("link", { name: "Join the draft" }).getAttribute("href");
  await page.goto(draftHref!);
  // `RoomTour` shows once, the first time a manager ever opens a draft room — dismiss it if it's
  // there, the identical no-op-for-a-manager-past-their-first-room shape `league-lifecycle.spec.ts`
  // already keeps.
  const gotIt = page.getByRole("button", { name: "Got it" });
  if ((await gotIt.count()) > 0) await gotIt.click();
}

/**
 * Seats `userEmail` on `leagueId` through the REAL join door (`joinPublicLeague`,
 * `@/league-service/join`) with an INJECTED, backdated `Clock` — the identical
 * "call the service layer directly with its own clock" idiom `global-setup.ts`'s own
 * `ensureDraftScheduleLeague` already uses for `createInvite`. This is deliberately NOT a raw
 * `UPDATE` against `teams` or `audit_events`: `audit_events` is a hash-chained, tamper-evident
 * log (`chain_scope`/`sequence`/`previous_event_hash`/`event_hash`) and `teams` carries no
 * `created_at` column at all — `LeagueHomeBody.justSeated` (D1) derives entirely from the
 * caller's own `member_joined` audit event (`joinedAtFor`, `@/league-service/draft-schedule`),
 * so seating the member through the real writer, with the clock it reads already in the past,
 * produces a properly-chained event that is simply already old — never a mutation of one that
 * already committed.
 *
 * `design-v2.spec.ts`'s own keyboard walk needs this: D1's just-seated summary intentionally
 * renders nothing but a one-line preview of the checklist's first item (`WaitingRoom`'s own
 * docblock — "the moment ends in an action... the checklist's own first item, promoted"), so the
 * interactive ranking controls the walk needs to reach are unreachable for a real five real
 * minutes after an ordinary join. Seating the walk's own identity here, ahead of the live
 * browser flow, means the later hold-interstitial-then-sign-in journey still runs for real
 * (`joinLeagueInTx`'s own "arriving twice costs nothing" branch, `ok: true, alreadyMember: true`)
 * — the mechanism is still exercised end to end, it simply resolves as a returning member rather
 * than a brand new one, which is what puts the room straight into its ordinary (checklist-visible)
 * view the moment the walk signs back in.
 */
export async function seedPastMember(db: Db, opts: { readonly leagueId: string; readonly userEmail: string; readonly minutesAgo: number }): Promise<void> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, opts.userEmail));
  if (user === undefined) {
    throw new Error(`[e2e] seedPastMember: no user found for ${opts.userEmail} — that identity's session must be warmed (global-setup) before this runs.`);
  }
  const pastIso = new Date(Date.now() - opts.minutesAgo * 60_000).toISOString();
  const outcome = await joinPublicLeague({ db, newId: () => crypto.randomUUID(), clock: { now: () => pastIso } }, { leagueId: opts.leagueId, userId: user.id });
  if (!outcome.ok) {
    throw new Error(`[e2e] seedPastMember: joinPublicLeague refused for ${opts.userEmail} on ${opts.leagueId}: ${JSON.stringify(outcome)}`);
  }
}
