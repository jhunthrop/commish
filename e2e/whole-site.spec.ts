import { readFileSync } from "node:fs";
import { expect, test } from "./support/fixtures";
import { E2E_DRAFT_SCHEDULE_INVITE_STATE, type DraftScheduleInvite } from "./global-setup";

/**
 * Phase 3.6 whole-site addendum, Task 22 Step 5: one journey touching every surface the
 * addendum designed, asserting each rendered its OWN chrome and its OWN first heading — never
 * a page that half-renders under the wrong frame. Plus the 404 walk: a stranger with no
 * account escapes a dead URL to `/browse` without ever being bounced into hosted sign-in.
 *
 * Chrome is asserted by landmark, which is what "its own chrome" means mechanically:
 * - A PUBLIC surface renders `PublicBar` (`role="banner"` carrying the wordmark and one
 *   "Sign in" link) and, on the four public pages plus the trust pages, `PublicFooter`
 *   (`role="navigation"` named "Legal and support").
 * - A SHELL surface renders `AppShell`: `TopBar` (`role="banner"`) plus the league rail
 *   (`role="navigation"` named "Your leagues").
 * No absolute counts anywhere (the shared dev database's contents drift between runs); every
 * assertion is about chrome, headings and named controls — the SSR-fake discipline's
 * relative-assertions rule.
 *
 * The invite code comes from `global-setup`'s own draft-schedule fixture file, not from any
 * other spec having run first — this file has no suite-order dependency.
 */

test("every addendum surface renders its own chrome and its own first heading", async ({ page, managerA, managerZero }) => {
  test.setTimeout(120_000);

  // --- The four public surfaces, signed out: PublicBar + PublicFooter -----------------------
  const publicChrome = async (where: string) => {
    await expect(page.getByRole("banner").getByRole("link", { name: "Commish" }), `${where}: wordmark`).toBeVisible();
    await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" }), `${where}: sign-in entry`).toBeVisible();
    const footer = page.getByRole("navigation", { name: "Legal and support" });
    await expect(footer, `${where}: trust footer`).toBeVisible();
    // THE THREE `PUBLIC_FOOTER_LINKS` ACTUALLY NAMES. This loop carried a fourth, "League rules",
    // which `public-footer.tsx` dropped on 2026-09-10 when `/league-rules` moved to the storefront
    // nav under its own page's name ("How it works") — so the spec had been asserting a link
    // nothing renders since before this branch began (pre-existing at 33aaa732, and
    // `public-footer.test.tsx` asserts the old name is gone). Spelled out rather than imported
    // from the component: the Playwright loader cannot resolve `next/link` out of a `.tsx`, so
    // the unit test beside the component is where that list stays honest.
    for (const target of ["Terms", "Privacy", "Support"]) {
      await expect(footer.getByRole("link", { name: target }), `${where}: footer target ${target}`).toBeVisible();
    }
    // The page it lost is still one tap away, in the nav that owns it now.
    await expect(page.getByRole("link", { name: "How it works" }).first(), `${where}: how it works`).toBeVisible();
  };

  await page.goto("/reviews");
  await expect(page.getByRole("heading", { name: "What managers are saying" })).toBeVisible();
  await publicChrome("/reviews");

  await page.goto("/browse");
  await expect(page.getByRole("heading", { name: "Open leagues" })).toBeVisible();
  await publicChrome("/browse");

  // The invite landing — the one page under /app a stranger reaches (middleware exemption).
  // Scoped to `main` for the landing's own sign-in CTA: `PublicBar`'s header link is a second
  // exact "Sign in" on this page (the collision `enforcement.spec.ts` already documents).
  const invite: DraftScheduleInvite = JSON.parse(readFileSync(E2E_DRAFT_SCHEDULE_INVITE_STATE, "utf8")) as DraftScheduleInvite;
  await page.goto(`/app/join/${invite.code}`);
  await expect(page.getByRole("heading", { name: "Join a league" })).toBeVisible();
  await expect(page.locator("main").getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await publicChrome("/app/join/[code]");

  // The failed-callback landing: real chrome, plain words, no digest, no provider name.
  await page.goto("/sign-in/problem");
  await expect(page.getByRole("heading", { name: "Sign-in did not go through" })).toBeVisible();
  await expect(page.getByText("Nothing about your account changed.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Commish" })).toBeVisible();

  // --- The four trust pages (Task 21 Step 4), each its own first heading --------------------
  for (const [path, heading] of [
    ["/support", "Support"],
    ["/league-rules", "How it works"],
    ["/legal/terms", "Terms"],
    ["/legal/privacy", "Privacy"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await publicChrome(path);
  }

  // --- The shell surfaces, signed in: TopBar + rail, each page's own heading ----------------
  const shellChrome = async (p: typeof managerA, where: string) => {
    await expect(p.getByRole("banner"), `${where}: top bar`).toBeVisible();
    await expect(p.getByRole("navigation", { name: "Your leagues" }), `${where}: league rail`).toBeVisible();
  };

  await managerA.goto("/app/profile");
  // THE TAB TITLE, not an `<h1>` reading "Your profile". This page's own heading is the MANAGER'S
  // NAME (`ManagerHeader`, Gameday law 2) and has been since before this branch; the words
  // "Your profile" live only in `pageTitle(...)`. Pre-existing stale assertion at 33aaa732, in
  // the same walk this round rewrites.
  await expect(managerA).toHaveTitle(/Your profile/);
  await shellChrome(managerA, "/app/profile");
  // The account room's own six components answer, not a second bespoke frame (Task 18): the
  // email renders as TEXT with its statement, never a field.
  await expect(managerA.getByText("WorkOS manages your sign-in, not Commish.")).toBeVisible();
  await expect(managerA.getByRole("radiogroup", { name: "Theme" })).toBeVisible();

  await managerA.goto("/app/admin/queue");
  await expect(managerA.getByRole("heading", { name: "Dispute queue" })).toBeVisible();
  await shellChrome(managerA, "/app/admin/queue");
  // Ruling 30 on the operator surface: order is the only ranking.
  await expect(managerA.getByText("Nothing here is ranked by how serious it looks.")).toBeVisible();

  // The review feed for a signed-in reader renders the SHELL, not the public bar — the same
  // page, the other chrome (design-system.md's signed-out-chrome rule, both directions).
  await managerA.goto("/reviews");
  await expect(managerA.getByRole("heading", { name: "What managers are saying" })).toBeVisible();
  await shellChrome(managerA, "/reviews signed in");

  // --- Zero leagues (Sideline, 2026-09-11): the lobby IS the page, under the same shell -----
  // The first-run fork this leg used to assert (an identity card above three explained paths) is
  // deleted with `firstRunPlan`. What the shell wraps now is the lobby and the create door.
  await managerZero.goto("/app");
  await expect(managerZero.getByRole("heading", { name: "Your leagues" })).toBeVisible();
  // THE TOP BAR ONLY, not `shellChrome`. `/app` IS the league rail's own full-page form, so the
  // rail yields the whole edge there rather than repeating itself (`railHiddenOn`, law 3) — which
  // has been true since the rail redesign and long before this branch, so the `shellChrome` call
  // this leg used to make was a third stale assertion in this walk (pre-existing at 33aaa732).
  await expect(managerZero.getByRole("banner"), "/app zero leagues: top bar").toBeVisible();
  await expect(managerZero.getByTestId("home-league-card")).toHaveCount(0);
  await expect(managerZero.getByTestId("open-rooms")).toBeVisible();
  // The create door is reachable from this state too, and carries the anchor `/browse`, the
  // league rail and the lobby's own empty state all point at.
  await expect(managerZero.locator("#create-league")).toBeVisible();
});

test("a 404 walk reaches /browse without an account", async ({ page }) => {
  // A genuinely signed-out visitor on a dead URL: `not-found.tsx` renders `PublicBar`
  // unconditionally (F14) and its primary escape is `/`, never a bounce into hosted sign-in.
  await page.goto("/definitely-not-a-page");
  await expect(page.getByRole("heading", { name: "We could not find that page." })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Commish" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to the home page" })).toBeVisible();

  // Click-and-verify, retried (the SSR-fake discipline): a server-rendered link is visible
  // before hydration attaches the router, so the click is retried until the URL proves it
  // landed rather than trusting the first press.
  await expect(async () => {
    await page.getByRole("link", { name: "Browse open leagues" }).click();
    await expect(page).toHaveURL(/\/browse$/, { timeout: 3_000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Open leagues" })).toBeVisible();
  // Still signed out at the destination: the public chrome's sign-in entry is present.
  await expect(page.getByRole("banner").getByRole("link", { name: "Sign in" })).toBeVisible();
});
