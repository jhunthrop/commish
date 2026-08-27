import { expect, test } from "./support/fixtures";

/**
 * Task 5's first-run fork, against a manager who genuinely has zero leagues — `managerZero`
 * (`e2e/support/fixtures.ts`), a stable identity `global-setup` mints and warms but neither the
 * seed script nor any other spec ever joins or creates a league for.
 *
 * `managerZero` syncs with the default `experienceTier` (`beginner`, `syncUserFromWorkOS`'s own
 * default), which seeds `helpLevel: "guided"` (`defaultPreferences`, `@/identity/preferences.ts`)
 * on first read. `firstRunPlan` (`@/identity/first-run.ts`) orders a beginner's paths
 * browse-join-create and shows the explainer — this is what proves that, end to end, through a
 * real signed-in session and the real production build, not just the pure function's own tests.
 */
test("a manager with zero leagues sees the fork, ordered and explained, and browsing reaches open leagues", async ({
  managerZero,
}) => {
  await managerZero.goto("/app");
  await expect(managerZero.getByRole("heading", { name: "Your leagues" })).toBeVisible();

  // The fork itself: a headline, the plain-language explainer (guided help only), and all four
  // paths present, in the beginner order browse leads. Task 17 puts the identity card
  // (`ProfileForm`, `variant="first-run"`) first — "Set up your manager profile" now leads the
  // level-3 heading list, ahead of the paths it used to open with; this is a deliberate
  // structure move, not a loosened assertion, so the array still asserts the exact order.
  // Phase 4.5, Task 9: "Try a mock draft" leads ALL of create/join/browse, unconditionally —
  // it is not one of the tier-ordered three (`firstRunPlan`'s own docblock).
  //
  // Text/label assertions here are scoped to `main` because this content streams: the App
  // Router flushes the panel into a hidden buffer (`div#S:1[hidden]`, a direct child of
  // `<body>`) an instant before the inline swap script moves it into the Suspense boundary,
  // and `getByText`/`getByLabel` strict resolution counts hidden elements — an unscoped
  // locator polling inside that window sees two copies and throws a strict-mode violation
  // (diagnosed with a MutationObserver, Task 12; the ledger's earlier "Display name" flake
  // was the same race). Role queries (`getByRole`) are immune — a hidden subtree is not in
  // the accessibility tree — which is why the heading assertions stay unscoped.
  const fork = managerZero.getByRole("main");
  await expect(fork.getByText(/A league is a group of managers/)).toBeVisible();
  const headings = managerZero.getByRole("heading", { level: 3 });
  await expect(headings).toHaveText([
    "Set up your manager profile",
    "Try a mock draft",
    "Find an open league",
    "Join with an invite",
    "Start a league",
  ]);
  await expect(fork.getByLabel("Display name")).toBeVisible();

  // Guidance is ordering, never removal — the other two paths' real controls are on the page
  // too, not hidden behind the one this test follows.
  await expect(fork.getByLabel("Invite link or code")).toBeVisible();
  await expect(fork.getByLabel("League name")).toBeVisible();

  // The old always-on wall (its own "Invited by a friend?" / "No group to play with yet?"
  // section headings) is gone for a zero-leagues manager — the fork already is those sections.
  await expect(managerZero.getByRole("heading", { name: "Invited by a friend?" })).toHaveCount(0);
  await expect(managerZero.getByText("Start or join another league")).toHaveCount(0);

  await managerZero.getByRole("link", { name: "Browse open leagues" }).click();
  await expect(managerZero).toHaveURL(/\/browse$/);
  await expect(managerZero.getByRole("heading", { name: "Open leagues" })).toBeVisible();
});

/**
 * Task 9's own exit criterion, end to end: a real signed-in manager writes a real 1-star review
 * through `ReviewComposer` on `/app/profile`, and a SEPARATE, signed-out browser context (`page`,
 * the base Playwright fixture — no `storageState`, unlike `managerA`/`managerB`/`managerZero`)
 * sees it lead `/reviews` — proving the feed is both unfiltered by rating and readable by the
 * first-timer persona it's for, who has not signed up yet.
 */
test("a signed-in manager writes a review, and the public feed shows only real ones", async ({ managerA, page }) => {
  await managerA.goto("/app/profile");
  await managerA.getByRole("radio", { name: "1, poor" }).check();
  await managerA
    .getByLabel("Your review")
    .fill(`This league ate my roster overnight and nobody ever explained why. Filed at ${Date.now()}.`);
  // "Post review" the first time this stable e2e identity ever runs this spec, "Save changes"
  // on every rerun after that (`ReviewComposer`'s upsert — `managerA` keeps the same one review
  // across runs, same stable-identity rationale as `MANAGER_A_STATE` itself).
  await managerA.getByRole("button", { name: /Post review|Save changes/ }).click();
  await expect(managerA.getByText("Saved.")).toBeVisible();

  // Flow analysis D3 (2026-08-27) changed what this leg proves. The review written above carries
  // the e2e signature ("Filed at <epoch>"), which is exactly what `fixture-filter.ts` exists to
  // keep off a stranger's screen — a founder's public page was leading with one seeded complaint.
  // So the honest assertion is the inverse of the old one: the author still sees their review in
  // their own account, and the PUBLIC feed refuses to show test data at all.
  await expect(managerA.getByLabel("Your review")).toHaveValue(/Filed at \d+/);

  await page.goto("/reviews");
  await expect(page.getByRole("heading", { name: "What managers are saying" })).toBeVisible();
  await expect(page.getByText(/This league ate my roster overnight/)).toHaveCount(0);
  // `exact` (2026-08-27): with the fixture review filtered, the page's honest empty state adds
  // "Sign in to write the first review" — a second link whose name contains this one's.
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
});
