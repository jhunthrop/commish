import { createRequire } from "node:module";
import type { Page } from "@playwright/test";
import { createDb } from "../src/db/client";
import { UI_CONFIG } from "../src/components/ui/config";
import {
  ensureOpenHoldLeague,
  ensureRoomJourneyLeague,
  expect,
  seedPastMember,
  SEEDED_SEASON_LEAGUE_ID,
  startDraftAndEnterRoom,
  test,
} from "./support/fixtures";
import { MANAGER_D_EMAIL, SEEDED_SEASON_CURRENT_WEEK } from "./global-setup";

/**
 * Phase 3.6, Task 13, Steps 3 and 4: the "efficient workflows" clause and the "browser-based
 * visual contrast checks" the design system doc has been promising since Phase 1.
 *
 * Two independent tests, two independent fixture leagues each (their own ids, wiped and rebuilt
 * every run — the same "a league only this test touches is cheaper to reason about" argument
 * `auth.spec.ts`'s own hold journey and `support/fixtures.ts`'s room-journey helper already make),
 * so neither test's own state ever depends on the other having run first or on
 * `enforcement.spec.ts`'s unrelated `E2E_DRAFT_SCHEDULE_LEAGUE_ID` journey.
 */

const E2E_DESIGNV2_WALK_HOLD_LEAGUE_ID = "e2e_designv2_walk_hold_league";
const E2E_DESIGNV2_WALK_HOLD_COMMISH_ID = "e2e_designv2_walk_hold_commish";
const WALK_LEAGUE_NAME = "DesignV2 Keyboard Walk League";

const E2E_DESIGNV2_AXE_HOLD_LEAGUE_ID = "e2e_designv2_axe_hold_league";
const E2E_DESIGNV2_AXE_HOLD_COMMISH_ID = "e2e_designv2_axe_hold_commish";
const AXE_HOLD_LEAGUE_NAME = "DesignV2 Axe Hold League";

const E2E_DESIGNV2_AXE_ROOM_LEAGUE_ID = "e2e_designv2_axe_room_league";
const E2E_DESIGNV2_AXE_ROOM_DRAFT_ID = "e2e_designv2_axe_room_draft";
const E2E_DESIGNV2_AXE_ROOM_TEAM_A_ID = "e2e_designv2_axe_room_team_a";
const E2E_DESIGNV2_AXE_ROOM_TEAM_B_ID = "e2e_designv2_axe_room_team_b";
const AXE_ROOM_LEAGUE_NAME = "DesignV2 Axe Room League";

test.beforeAll(async () => {
  const db = createDb();
  try {
    await ensureOpenHoldLeague(db, {
      leagueId: E2E_DESIGNV2_WALK_HOLD_LEAGUE_ID,
      commishId: E2E_DESIGNV2_WALK_HOLD_COMMISH_ID,
      name: WALK_LEAGUE_NAME,
    });
    // See `seedPastMember`'s own docblock (`support/fixtures.ts`): the walk's identity is
    // seated here, through the real join door, with a clock already past D1's five-minute
    // window — the live hold-then-sign-in journey below still runs for real, it simply resolves
    // as a returning member, which is what puts the room in its ordinary (checklist-visible)
    // view the instant the walk signs back in, rather than behind D1's own one-line summary.
    await seedPastMember(db, {
      leagueId: E2E_DESIGNV2_WALK_HOLD_LEAGUE_ID,
      userEmail: MANAGER_D_EMAIL,
      minutesAgo: UI_CONFIG.waitingRoom.justSeatedMinutes + 5,
    });
    await ensureOpenHoldLeague(db, {
      leagueId: E2E_DESIGNV2_AXE_HOLD_LEAGUE_ID,
      commishId: E2E_DESIGNV2_AXE_HOLD_COMMISH_ID,
      name: AXE_HOLD_LEAGUE_NAME,
    });
    await ensureRoomJourneyLeague(db, {
      leagueId: E2E_DESIGNV2_AXE_ROOM_LEAGUE_ID,
      draftId: E2E_DESIGNV2_AXE_ROOM_DRAFT_ID,
      teamAId: E2E_DESIGNV2_AXE_ROOM_TEAM_A_ID,
      teamBId: E2E_DESIGNV2_AXE_ROOM_TEAM_B_ID,
      name: AXE_ROOM_LEAGUE_NAME,
    });
  } finally {
    await db.$client.end();
  }
});

// -------------------------------------------------------------------------------------------
// Step 3: the keyboard walk. Front door -> card -> hold -> sign-in -> waiting room -> rank a
// slot -> league home, with NO pointer event anywhere in it. `.focus()` is a plain DOM call, not
// a simulated pointer event, so `.focus()` + `page.keyboard.press(...)` is what "keyboard only"
// means here — the same activation a real Tab-then-Enter user produces, without this spec
// counting live tab stops across a whole page (`waiting-room.test.tsx`'s own keyboard-only test
// does that at component scale, where it is cheap; this spec walks real pages).
//
// The AuthKit boundary is where this walk stops being able to drive the browser at all (`auth.
// spec.ts`'s own rule, restated): it asserts the click left our origin for AuthKit, carrying our
// `redirect_uri` and a `state` param, and goes no further. What comes after — a real human
// finishing the hosted form and WorkOS redirecting back to `/join/[leagueId]/hold` — is
// simulated by continuing as `managerD`, a signed-in fixture session, landing on that exact URL
// the way the callback would have. Nothing about the product's own logic is skipped: `managerD`
// still goes through the real `returnFromSignIn` seat grant, live.
// -------------------------------------------------------------------------------------------

test("front door -> card -> hold -> sign-in -> waiting room -> rank a slot -> league home, keyboard only", async ({ browser, managerD }) => {
  test.setTimeout(90_000);

  const anonContext = await browser.newContext();
  try {
    const page = await anonContext.newPage();

    // --- Front door, signed out --------------------------------------------------------------
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Real leagues. Real seats. Pick one and you are drafting this week." })).toBeVisible();

    // --- Keyboard-only nav to the shelf (`PublicBar`'s own "Open leagues" link) --------------
    const openLeagues = page.getByRole("link", { name: "Open leagues" });
    await openLeagues.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/browse$/);
    await expect(page.getByRole("heading", { name: "Open leagues" })).toBeVisible();

    // --- The card, keyboard-activated --------------------------------------------------------
    const card = page.locator("li").filter({ has: page.getByRole("heading", { name: WALK_LEAGUE_NAME, exact: true }) });
    await expect(card).toBeVisible();
    const cta = card.getByRole("link").filter({ hasText: "Take a seat" });
    const ownOrigin = new URL(page.url()).origin;

    await cta.focus();
    // Click-and-verify, retried (the SSR-fake discipline `auth.spec.ts` already establishes): a
    // server-rendered `<a href>` still navigates on a pre-hydration Enter, but the receipt this
    // asserts is the actual departure from our own origin, never the keypress alone.
    await expect(async () => {
      await page.keyboard.press("Enter");
      await page.waitForURL((url) => url.origin !== ownOrigin, { timeout: 5_000 });
    }).toPass({ timeout: 20_000 });

    // --- The sign-in boundary: assert the redirect, never walk the hosted form ---------------
    const destination = new URL(page.url());
    expect(destination.origin).not.toBe(ownOrigin);
    expect(destination.searchParams.get("state")).toBeTruthy();
    const redirectUri = destination.searchParams.get("redirect_uri");
    expect(redirectUri).toBeTruthy();
    expect(new URL(redirectUri!).pathname).toBe("/callback");
  } finally {
    await anonContext.close();
  }

  // --- Continue as a signed-in fixture: the callback lands back on the hold page ------------
  // `seedPastMember` (`support/fixtures.ts`, run in `beforeAll`) already seated this identity on
  // this league, through the real join door, with its `member_joined` audit event already past
  // D1's five-minute window — `returnFromSignIn` still runs for real here, it resolves as
  // `joinLeagueInTx`'s own "arriving twice costs nothing" branch, which is what puts the room in
  // its ordinary view (the checklist, not D1's one-line summary) the instant the walk lands.
  await managerD.goto(`/join/${E2E_DESIGNV2_WALK_HOLD_LEAGUE_ID}/hold`);
  await expect(managerD).toHaveURL(new RegExp(`/app/leagues/${E2E_DESIGNV2_WALK_HOLD_LEAGUE_ID}$`));

  // --- Waiting room ---------------------------------------------------------------------------
  await expect(managerD.getByRole("heading", { name: WALK_LEAGUE_NAME, exact: true })).toBeVisible();

  // --- Rank a slot, keyboard only ------------------------------------------------------------
  // Retried per the SSR-fake discipline (P13 review): a React button's Enter is a silent no-op
  // pre-hydration (unlike a native link's), so each press re-fires until its own receipt shows.
  await expect(async () => {
    const receipt = managerD.getByRole("button", { name: "Move slot 1 up" });
    if (!(await receipt.isVisible())) {
      await managerD.getByRole("button", { name: "Add slot 1 to your ranking" }).focus();
      await managerD.keyboard.press("Enter");
    }
    await expect(receipt).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });

  await expect(async () => {
    const receipt = managerD.getByText(/^Saved\. You ranked: 1\./);
    if (!(await receipt.isVisible())) {
      await managerD.getByRole("button", { name: "Save ranking" }).focus();
      await managerD.keyboard.press("Enter");
    }
    await expect(receipt).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });

  // --- League home: the walk ends on the league's own page, ranking persisted --------------
  await expect(managerD).toHaveURL(new RegExp(`/app/leagues/${E2E_DESIGNV2_WALK_HOLD_LEAGUE_ID}$`));
  await expect(managerD.getByRole("heading", { level: 1 })).toBeVisible();
});

// -------------------------------------------------------------------------------------------
// Step 4: contrast, in a real browser. Component tests (`tokens.test.ts`) run without a
// stylesheet and prove the NUMBERS; this proves the PAIRINGS actually shipped — axe's own
// color-contrast rule, scripted against the real, built CSS, on each of the nine v2 surfaces,
// in BOTH themes (the founder's both-themes ruling: light is as load-bearing as dark). The
// harness copies `mobile-360.spec.ts`'s own page-loop shape (File Structure's own pointer).
//
// `axe-core` is already a direct dependency of this repo (`vitest-axe`'s own engine, used by
// every component test in `src/**`) — no new dependency. Playwright has no bundled axe runner,
// so this injects the same UMD build `vitest-axe` ships transitively, via `page.addScriptTag`,
// which inlines the file's contents into the page rather than fetching it as an external
// resource — the one shape this app's `script-src 'self' 'unsafe-inline'` CSP (`next.config.ts`)
// allows without a nonce.
// -------------------------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const AXE_CORE_PATH = require.resolve("axe-core/axe.min.js");

interface AxeViolationNode {
  readonly html: string;
  readonly target: readonly string[];
}

interface AxeViolation {
  readonly id: string;
  readonly help: string;
  readonly nodes: readonly AxeViolationNode[];
}

declare global {
  interface Window {
    axe?: {
      run: (
        context: Document | string,
        options: { readonly runOnly: readonly string[] },
      ) => Promise<{ readonly violations: readonly AxeViolation[] }>;
    };
  }
}

const THEME_STORAGE_KEY = "commish.theme";

/**
 * Sets the SAME `localStorage` key `ThemeProvider.setTheme` writes (`src/design/
 * theme-provider.tsx`'s own `STORAGE_KEY`), then reloads — the real path a returning visitor's
 * stored preference takes, not a shortcut. A direct `document.documentElement.setAttribute(...)`
 * looked equivalent and is NOT: `ThemeProvider` always mounts at `"system"` first (its own
 * docblock — server and first client render must match) and only reaches the real stored theme
 * once its own effects settle, so a manual attribute write racing that settling gets silently
 * overwritten back to `"system"` the instant it does. Reloading with the preference already in
 * storage sidesteps that race, and `waitForFunction` confirms the attribute the scan is about to
 * run against is actually the one this call asked for.
 *
 * The attribute flipping is not the last event, though: every interactive element in this
 * product carries `transition-colors` (`docs/design-system.md`'s own motion tokens — the
 * longest, `--commish-motion-duration-slow`, is 320ms), so the CSS custom properties it reads
 * ANIMATE from the old theme's values to the new one rather than snapping — sampling
 * `getComputedStyle` the instant the attribute matches catches colors mid-transition, an
 * artifact this harness proved by injection (a bare `data-theme` check turned a reported
 * violation on a link with nothing but `transition-colors` and an inherited color into a clean
 * pass once a settle wait was added). NOT `networkidle`: the draft room holds an open SSE
 * subscription, which never goes idle by design, so this is a flat wait — long enough to cover
 * a client-heavy page's own code-split chunks finishing (`/app/drafts/[draftId]` proved the
 * shorter wait insufficient for its filter row specifically) as well as the CSS transition.
 */
async function setThemeAndSettle(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.evaluate(({ key, t }) => window.localStorage.setItem(key, t), { key: THEME_STORAGE_KEY, t: theme });
  await page.reload();
  await page.waitForFunction((t) => document.documentElement.getAttribute("data-theme") === t, theme, { timeout: 10_000 });
  await page.waitForTimeout(1_500);
}

const THEMES: readonly ("light" | "dark")[] = ["light", "dark"];

/**
 * Runs axe's color-contrast rule against `page`'s CURRENT url in both themes and asserts zero
 * violations. `include` narrows the scan to one selector (Standings' own check, scoped to its
 * `<table>` rather than the whole League Home page it shares a navigation with) — omitted, the
 * whole document is scanned.
 */
async function assertContrastClean(page: Page, where: string, include?: string): Promise<void> {
  for (const theme of THEMES) {
    await setThemeAndSettle(page, theme);
    await page.addScriptTag({ path: AXE_CORE_PATH });
    const violations = await page.evaluate(async (selector) => {
      const result = await window.axe!.run(selector ?? document, { runOnly: ["color-contrast"] });
      return result.violations.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.map((n) => ({ html: n.html, target: n.target })) }));
    }, include ?? null);
    expect(violations, `${where}, ${theme} theme: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
  }
}

test("every v2 surface clears axe's color-contrast rule, in both themes", async ({ browser, managerA }) => {
  test.setTimeout(180_000);

  // --- The two signed-out surfaces, one shared anonymous context ---------------------------
  const anonContext = await browser.newContext();
  try {
    const anonPage = await anonContext.newPage();

    await anonPage.goto("/");
    await expect(anonPage.getByRole("heading", { name: "Real leagues. Real seats. Pick one and you are drafting this week." })).toBeVisible();
    await assertContrastClean(anonPage, "the front door");

    await anonPage.goto("/browse");
    await expect(anonPage.getByRole("heading", { name: "Open leagues" })).toBeVisible();
    await assertContrastClean(anonPage, "browse");

    await anonPage.goto(`/join/${E2E_DESIGNV2_AXE_HOLD_LEAGUE_ID}/hold`);
    await expect(anonPage.getByRole("heading", { name: AXE_HOLD_LEAGUE_NAME })).toBeVisible();
    await expect(anonPage.getByTestId("seat-hold-countdown")).toBeVisible();
    await assertContrastClean(anonPage, "the hold interstitial");
  } finally {
    await anonContext.close();
  }

  // --- The signed-in surfaces, manager A's own session --------------------------------------
  await managerA.goto(`/app/leagues/${E2E_DESIGNV2_AXE_ROOM_LEAGUE_ID}`);
  await expect(managerA.getByRole("heading", { name: AXE_ROOM_LEAGUE_NAME, exact: true })).toBeVisible();
  await assertContrastClean(managerA, "the waiting room");

  await managerA.goto("/app");
  await expect(managerA.getByRole("heading", { name: "Your leagues" })).toBeVisible();
  await assertContrastClean(managerA, "the locker room");

  await managerA.goto(`/app/leagues/${SEEDED_SEASON_LEAGUE_ID}`);
  await expect(managerA.getByRole("heading", { level: 1 })).toBeVisible();
  await assertContrastClean(managerA, "league home");
  // Standings has no route of its own — it renders inline on league home (`league-home.tsx`'s
  // own `<StandingsTable>`) — so this scopes the SAME page's axe scan to its `<table>` rather
  // than re-navigating to re-scan the whole page under a second name.
  await assertContrastClean(managerA, "standings", "table");

  await managerA.goto(`/app/leagues/${SEEDED_SEASON_LEAGUE_ID}/matchups/${SEEDED_SEASON_CURRENT_WEEK}`);
  await expect(managerA.getByRole("heading", { level: 1 })).toBeVisible();
  await assertContrastClean(managerA, "a matchup week");

  await startDraftAndEnterRoom(managerA, E2E_DESIGNV2_AXE_ROOM_LEAGUE_ID);
  await expect(managerA.getByLabel("Player pool")).toBeVisible();
  await assertContrastClean(managerA, "the draft room");
});
