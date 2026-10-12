import { eq } from "drizzle-orm";
import { createDb, type Db } from "@research-ts/db/client";
import { drafts, leagues, scoringSettings, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@research-ts/domain/roster";
import { STANDARD_SCORING } from "@research-ts/domain/scoring";
import { expect, test } from "./support/fixtures";

/**
 * The way in, stopped at the boundary (Task 16 Step 6). Three tests, none of which touches a
 * hosted form: A2 (the parent's Global Constraints, incorporated here) is absolute — a spec may
 * assert that a click leaves our origin, that the destination carries our `redirect_uri` and a
 * `state` parameter, and that a `returnTo` we set arrives where it should, but no spec here ever
 * types into the WorkOS hosted form and no spec stubs the WorkOS domain.
 */

test("from /reviews signed out, Sign in leaves our origin for the AuthKit host, carrying our redirect_uri and a state param", async ({ page }) => {
  await page.goto("/reviews");
  const ownOrigin = new URL(page.url()).origin;

  // Click-and-verify, retried (the SSR-fake discipline): `SignInLink` renders a real `<a href>`,
  // so even a pre-hydration click still fires a real browser navigation — asserted against the
  // actual receipt (having left our own origin) rather than trusted on the click alone.
  await expect(async () => {
    await page.getByRole("link", { name: "Sign in" }).first().click();
    await page.waitForURL((url) => url.origin !== ownOrigin, { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });

  const destination = new URL(page.url());
  expect(destination.origin).not.toBe(ownOrigin);

  expect(destination.searchParams.get("state")).toBeTruthy();
  const redirectUri = destination.searchParams.get("redirect_uri");
  expect(redirectUri).toBeTruthy();
  // The redirect_uri is OUR OWN callback route — the thing WorkOS will hand the visitor back to
  // once they finish on its side. Its ORIGIN is `NEXT_PUBLIC_WORKOS_REDIRECT_URI`
  // (`.env.local`), a value independent of `E2E_BASE_URL`/this run's own port (see playwright.
  // config.ts's own documented port-3100 deviation), so only the path is asserted here.
  expect(new URL(redirectUri!).pathname).toBe("/callback");
});

test("/sign-in with a hostile returnTo still leaves for AuthKit, and the hostile value appears nowhere in the outgoing URL", async ({ page }) => {
  await page.goto("/");
  const ownOrigin = new URL(page.url()).origin;

  const hostile = "https://evil.example";
  await page.goto(`/sign-in?returnTo=${encodeURIComponent(hostile)}`);

  const destination = page.url();
  expect(new URL(destination).origin).not.toBe(ownOrigin);
  expect(destination).not.toContain("evil.example");
  expect(destination).not.toContain(encodeURIComponent(hostile));
});

/**
 * NO SIGN-OUT TEST LIVES HERE. `managerSignOut` is a SINGLE-USE identity per run — signing out
 * revokes the session server-side (`support/fixtures.ts`'s own docblock), so the first test to
 * spend it leaves every later consumer looking at a dead session. A duplicate walk added here
 * during the Ive campaign did exactly that: it ran first (auth sorts before season), and
 * `season.spec.ts`'s original sign-out test then failed on `/app` with no "Your leagues"
 * heading, for eighteen seconds, every run. The chain is covered once, in `season.spec.ts:117`,
 * which asserts strictly more than this copy did: both WorkOS hops AND the landed-out state.
 * Verify the Sign out button's own chrome there; never add a second consumer of this identity.
 */

// -------------------------------------------------------------------------------------------
// The hold journey (Phase 3.6, Task 6) — the fourth test A16's own Step 6 ledger note promised
// ("this step writes that sentence into the parent task's ledger note and asserts it in
// e2e/auth.spec.ts's hold journey"): the seat-hold cookie has to survive the top-level GET a
// signed-in visitor's browser makes landing BACK on `/join/[leagueId]/hold` from WorkOS, and
// `SameSite=Lax` only allows that if the cookie's own `Path` covers this route in the first
// place. `Path=/` is the load-bearing fact this journey exists to prove, not merely state.
//
// A dedicated, wiped-and-rebuilt public league (the identical `ensureSlotPreferenceLeague` idiom
// `formats-and-lobby.spec.ts` already uses for the same class of hazard): this journey only ever
// claims a hold, never joins, so nothing here could ever race another spec for a real seat — but
// a league only this test touches is still cheaper to reason about than one shared with the rest
// of the suite.
// -------------------------------------------------------------------------------------------

const E2E_HOLD_LEAGUE_ID = "e2e_auth_hold_league";
const E2E_HOLD_COMMISH_ID = "e2e_auth_hold_commish";

async function ensureHoldJourneyLeague(db: Db): Promise<void> {
  await db.delete(leagues).where(eq(leagues.id, E2E_HOLD_LEAGUE_ID));
  await db
    .insert(users)
    .values({ id: E2E_HOLD_COMMISH_ID, email: `${E2E_HOLD_COMMISH_ID}@commish-lab.test`, displayName: "Hold Commish" })
    .onConflictDoNothing({ target: users.id });
  await db.insert(leagues).values({
    id: E2E_HOLD_LEAGUE_ID,
    name: "E2E Hold Journey League",
    format: "snake",
    teamCount: 12,
    isPublicMatchmade: true,
    commissionerUserId: E2E_HOLD_COMMISH_ID,
    rosterSlots: [...STANDARD_ROSTER_SLOTS],
  });
  await db.insert(scoringSettings).values({ leagueId: E2E_HOLD_LEAGUE_ID, ...STANDARD_SCORING });
  await db.insert(drafts).values({
    id: `${E2E_HOLD_LEAGUE_ID}_draft`,
    leagueId: E2E_HOLD_LEAGUE_ID,
    format: "snake",
    status: "scheduled",
    kickoffAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    auctionBudget: null,
  });
}

test.describe("the hold journey (Task 6)", () => {
  test.beforeAll(async () => {
    const db = createDb();
    try {
      await ensureHoldJourneyLeague(db);
    } finally {
      await db.$client.end();
    }
  });

  test("claiming a seat sets a real Path=/ cookie, and Sign in to finish joining leaves for AuthKit carrying the hold's own return path", async ({ page }) => {
    // The real click path: the browse card's own "Sign in to join" is a plain `SignInLink`
    // (asserted by other specs) — this journey starts one step later, on the interstitial itself,
    // which is where the hold is actually claimed (Task 6 Step 4).
    await page.goto(`/join/${E2E_HOLD_LEAGUE_ID}/hold`);
    const ownOrigin = new URL(page.url()).origin;

    // `level: 1` is load-bearing (Task 12 of the mock-drafts closeout): once `SeatHoldPanel`'s
    // on-mount claim lands, its own panel eyebrow is a SECOND heading with this exact name
    // (`Panel`'s `<Heading className={EYEBROW}>{title}</Heading>`), so an un-leveled locator is a
    // strict-mode violation whenever that POST beats this assertion's first poll — a race this
    // spec loses only on a fast round trip, which is exactly when everything is working.
    await expect(page.getByRole("heading", { level: 1, name: "E2E Hold Journey League" })).toBeVisible();
    // `SeatHoldPanel` claims the hold on mount — the countdown is the receipt that the real
    // `POST /api/public/leagues/[leagueId]/hold` round trip actually happened, not merely that
    // the page rendered.
    await expect(page.getByTestId("seat-hold-countdown")).toBeVisible();

    const cookies = await page.context().cookies();
    const hold = cookies.find((cookie) => cookie.name === "seat_hold");
    expect(hold, "the hold cookie was never set").toBeDefined();
    expect(hold?.httpOnly).toBe(true);
    expect(hold?.sameSite).toBe("Lax");
    // The load-bearing assertion: a `Path` scoped to `/api/public/leagues` would never be sent on
    // the top-level GET back from WorkOS to THIS route — `Path=/` is the simplest correct answer,
    // and this is what keeps it that way rather than merely documented as one.
    expect(hold?.path).toBe("/");

    const signInLink = page.getByRole("link", { name: "Sign in to finish joining E2E Hold Journey League" });
    await expect(signInLink).toHaveAttribute("href", `/sign-in?returnTo=%2Fjoin%2F${E2E_HOLD_LEAGUE_ID}%2Fhold`);

    // Click-and-verify, retried (the SSR-fake discipline this file's own first test already uses).
    await expect(async () => {
      await signInLink.click();
      await page.waitForURL((url) => url.origin !== ownOrigin, { timeout: 5_000 });
    }).toPass({ timeout: 20_000 });

    const destination = new URL(page.url());
    expect(destination.origin).not.toBe(ownOrigin);
    expect(destination.searchParams.get("state")).toBeTruthy();
    const redirectUri = destination.searchParams.get("redirect_uri");
    expect(redirectUri).toBeTruthy();
    expect(new URL(redirectUri!).pathname).toBe("/callback");

    // The hold cookie is STILL held after leaving — it is what the callback's own top-level GET
    // back to `/join/[leagueId]/hold` will carry, never cleared by the mere act of leaving.
    const afterLeaving = (await page.context().cookies()).find((cookie) => cookie.name === "seat_hold");
    expect(afterLeaving?.value).toBe(hold?.value);
  });
});
