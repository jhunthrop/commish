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
    for (const target of ["Terms", "Privacy", "Support", "League rules"]) {
      await expect(footer.getByRole("link", { name: target }), `${where}: footer target ${target}`).toBeVisible();
    }
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
  await expect(managerA.getByRole("heading", { name: "Your profile" })).toBeVisible();
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

  // --- First run (Task 17): the zero-league fork under the shell, identity card first -------
  await managerZero.goto("/app");
  await expect(managerZero.getByRole("heading", { name: "Your leagues" })).toBeVisible();
  await shellChrome(managerZero, "/app first run");
  await expect(managerZero.getByRole("heading", { name: "Set up your manager profile" })).toBeVisible();
  await expect(managerZero.getByLabel("Display name")).toBeVisible();
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
