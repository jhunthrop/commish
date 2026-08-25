import { expect, SEEDED_SEASON_LEAGUE_ID, test } from "./support/fixtures";

/**
 * The season half, against the seeded league `global-setup` handed manager A the
 * commissioner's chair in: set a lineup, read a week's honest state, read the standings, ask
 * the advisor, and browse. Every one of these has unit and route coverage already — what a
 * browser adds is that the page actually renders them, in the real production build, with real
 * data.
 */
test("a manager sets a lineup, and sees the week's real state and the standings that follow", async ({ managerA }) => {
  await managerA.goto(`/app/leagues/${SEEDED_SEASON_LEAGUE_ID}`);
  await expect(managerA.getByRole("heading", { level: 1 })).toBeVisible();

  // Standings render with real, already-played results.
  await expect(managerA.getByRole("table")).toBeVisible();

  // The lineup editor saves. The seeded season is fully scored, so the current week may be
  // locked; both outcomes are correct and the editor must say which plainly rather than
  // failing silently. Asserting the disjunction FIRST is what keeps this honest: without it, a
  // regression that made BOTH "Save lineup" and the locked message disappear would silently
  // skip the `if` below and still pass.
  const save = managerA.getByRole("button", { name: /Save lineup/i });
  // COPY MOVE, followed deliberately: the design-v2 gauntlet wave (8f7b8f9) retoned the lock
  // sentence from "can't change" to "cannot change" (matching the server's own copy in
  // `lineups.ts`), and the old `/can.t/` pattern cannot match "cannot". Same lock, same
  // disjunction below — tighter pattern.
  const locked = managerA.getByText(/lineup cannot change/i);
  await expect(save.or(locked).first()).toBeVisible();
  if ((await save.count()) > 0) {
    await save.first().click();
    await expect(managerA.getByRole("status").or(managerA.getByRole("alert")).first()).toBeVisible();
  }

  // The manual "Score Week" control is retired — live scoring exists, so no commissioner
  // stamps a week final by hand. The week instead carries an honest state badge, and the
  // lineup editor's lock message agrees with it: a week that has started is locked, a week
  // that hasn't is still editable. Asserting the disjunction FIRST is what keeps this honest —
  // without it, a regression that removed all three states would silently skip past both `if`
  // branches below and still pass.
  const notStarted = managerA.getByText("Not started");
  const inProgress = managerA.getByText("In progress");
  const final = managerA.getByText("Final", { exact: true });
  await expect(notStarted.or(inProgress).or(final).first()).toBeVisible();
  await expect(managerA.getByRole("button", { name: /^Score Week/ })).toHaveCount(0);

  const started = (await inProgress.count()) > 0 || (await final.count()) > 0;
  if (started) {
    await expect(locked).toBeVisible();
  } else {
    await expect(save).toBeVisible();
  }
});

test("the advisor answers from this league's own numbers, with or without a model key", async ({ managerA }) => {
  await managerA.goto(`/app/leagues/${SEEDED_SEASON_LEAGUE_ID}`);
  await managerA.getByLabel("Ask about your lineup").fill("Who should I start at flex?");
  await managerA.getByRole("button", { name: /Ask|Get advice/i }).first().click();
  // With no ANTHROPIC_API_KEY the advisor answers from the app's own math and labels itself.
  // Either way it answers: a missing key is a designed state, not an error. The idle panel
  // (heading, "Advice only." subtitle, the form) already has well over 20 characters of text,
  // so a length-based assertion on the whole section would pass before any answer arrives.
  // advisor-panel.tsx only renders the headline paragraph once `advice !== null`, so waiting
  // on it is waiting on the actual answer, not the idle shell.
  await expect(managerA.locator("section[aria-label='Lineup advisor'] p.font-display")).toBeVisible({ timeout: 30_000 });
});

test("a signed-in manager can browse open leagues and join one", async ({ managerB }) => {
  await managerB.goto("/browse");
  await expect(managerB.getByRole("heading", { name: "Open leagues" })).toBeVisible();
  // Pre-existing drift found while touching this spec for Task 5: `SeatMeter` (F17, the one seat
  // sentence for the whole product) has read "X of Y seated" since well before this task, never
  // "joined" — this assertion never matched current product copy.
  await expect(managerB.getByText(/of \d+ seated/).first()).toBeVisible();
  // The stake disclosure appears twice by design (the stake-tier filter's hint, and again
  // below the results — see browse-filters.tsx) so this is deliberately not a strict match.
  await expect(managerB.getByText("No money changes hands.").first()).toBeVisible();

  // Filtering narrows, and the URL carries it. Phase 3.6, Task 5, Step 4 replaced the old
  // four-`Select` filter form with four pills (ruling 1: "variety in toggles, not queues") —
  // "Newer players" is the surviving `experienceTier` axis, the same one this spec always
  // exercised, now reached by a link rather than a form submit.
  await managerB.getByRole("link", { name: "Newer players" }).click();
  await expect(managerB).toHaveURL(/experienceTier=beginner/);
  await expect(managerB.getByText("Sunday Regulars")).toHaveCount(0);
  // Task 13 (rows on lg+): the shelf renders every league TWICE in the DOM — a `LeagueRow` for
  // lg+ and an `OpenLeagueCard` below lg, one hidden by the breakpoint — so a bare text read
  // resolves to two nodes and trips strict mode. The role query sees only the visible form's
  // heading (rows kept the league-name heading element), at either viewport.
  await expect(managerB.getByRole("heading", { name: "Rookie Snake Room" })).toBeVisible();

  // Scoped to MEMBER cards, not the whole page (Phase 3.5 addendum, Task 15; re-anchored by
  // Phase 3.7, Task 6): house cards share the ONE merged shelf grid (`OpenLeagueShelf`), render
  // the identical "Join {name}" accessible-name shape, and are never narrowed by the filter
  // above — a bare `.first()` over the page can land on a house card instead, and a house league
  // declared `beginner`-tier would refuse a veteran manager B has become across this suite's own
  // other specs. Each member card's `<li>` carries `data-testid="member-league"` for exactly
  // this scoping (the old wrapper-level `public-league-list` testid died with the two-section
  // shelf).
  await managerB.getByTestId("member-league").getByRole("button", { name: /^Join / }).first().click();
  await expect(managerB).toHaveURL(/\/app\/leagues\//);
  await expect(managerB.getByRole("heading", { level: 1 })).toBeVisible();
});

/**
 * The coverage hole that let a broken sign-out ship. `AppHeader`'s Sign out is a real form POST,
 * and `signOut()` answers it with a redirect to WorkOS's hosted logout endpoint before WorkOS
 * redirects back to `/`. Chromium enforces `form-action` across that WHOLE chain, so a CSP
 * naming only `'self'` blocked the middle hop: the local sealed cookie cleared, the IdP session
 * survived, and the next sign-in silently resumed the old identity. Every other spec in this
 * suite signs IN through a cookie `global-setup` mints directly, so not one of them ever
 * exercised the way out.
 *
 * `managerSignOut` is a dedicated identity for exactly this: signing out revokes the session
 * server-side, and doing that to manager A, B or zero would break whichever specs happen to run
 * after this one.
 */
test("a manager signs out, and the redirect chain reaches WorkOS rather than being refused", async ({ managerSignOut }) => {
  // Every navigation the click causes, recorded before it happens. This is the assertion: a
  // `form-action` missing either WorkOS origin aborts the chain AT that hop, so the host simply
  // never appears here. Asserting the hops is stronger than asserting the absence of a console
  // error, because Chromium's violation message names the ORIGINAL form url and not the hop it
  // actually refused — it cannot tell you which origin is missing.
  const navigations: string[] = [];
  managerSignOut.on("request", (request) => {
    if (request.isNavigationRequest()) navigations.push(new URL(request.url()).host);
  });

  await managerSignOut.goto("/app");
  await expect(managerSignOut.getByRole("heading", { name: "Your leagues" })).toBeVisible();

  await managerSignOut.getByRole("button", { name: "Sign out" }).click();

  // Hop 2 and hop 3 of the chain `next.config.ts` documents. Under the old `form-action 'self'`
  // neither was ever reached; under `'self' https://api.workos.com` alone, only the first was.
  await expect
    .poll(() => navigations.includes("api.workos.com"), { message: "the sign-out POST never reached WorkOS's logout endpoint" })
    .toBe(true);
  await expect
    .poll(() => navigations.some((host) => host.endsWith(".authkit.app")), {
      message: "the WorkOS logout redirect to the hosted AuthKit domain was refused",
    })
    .toBe(true);

  // Where hop 4 LANDS is a WorkOS dashboard setting (the app's homepage url), not this app's
  // code, so this deliberately asserts the state instead of the destination: the session is
  // gone, and the product offers the way back in rather than a signed-in chrome.
  await managerSignOut.goto("/browse");
  await expect(managerSignOut.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  await expect(managerSignOut.getByRole("button", { name: "Sign out" })).toHaveCount(0);
});

test("a signed-OUT visitor can browse but is asked to sign in before joining", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/browse");
  await expect(page.getByRole("heading", { name: "Open leagues" })).toBeVisible();
  // Phase 3.6, Task 5: `OpenLeagueCard`'s signed-out CTA reads "Take a seat in {league}." (or
  // "Take the last seat…", plus a "Newer players only." clause on a beginner-only card) —
  // deliberately named, per league, rather than the old generic "Sign in to join" this replaced.
  await expect(page.getByRole("link", { name: /^Take (a seat|the last seat) in / }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Join / })).toHaveCount(0);
  await context.close();
});
