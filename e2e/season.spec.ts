import { expect, SEEDED_SEASON_LEAGUE_ID, test } from "./support/fixtures";

/**
 * The season half, against the seeded league `global-setup` handed manager A the
 * commissioner's chair in: set a lineup, score a week, read the standings, ask the advisor,
 * and browse. Every one of these has unit and route coverage already — what a browser adds is
 * that the page actually renders them, in the real production build, with real data.
 */
test("a manager sets a lineup, scores a week, and reads the standings that follow", async ({ managerA }) => {
  await managerA.goto(`/app/leagues/${SEEDED_SEASON_LEAGUE_ID}`);
  await expect(managerA.getByRole("heading", { level: 1 })).toBeVisible();

  // Standings render with real, already-played results.
  await expect(managerA.getByRole("table")).toBeVisible();

  // The lineup editor saves. The seeded season is fully scored, so the current week may be
  // locked; both outcomes are correct and the editor must say which plainly rather than
  // failing silently.
  const save = managerA.getByRole("button", { name: /Save lineup/i });
  if ((await save.count()) > 0) {
    await save.first().click();
    await expect(managerA.getByRole("status").or(managerA.getByRole("alert")).first()).toBeVisible();
  }

  // The commissioner can score the current week, and the page reflects it.
  const score = managerA.getByRole("button", { name: /^Score Week/ });
  await expect(score).toBeVisible();
  await score.click();
  await expect(managerA.getByRole("status").filter({ hasText: /Scored \d+ matchups\./ })).toBeVisible();
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
  await expect(managerB.getByText(/of \d+ joined/).first()).toBeVisible();
  // The stake disclosure appears twice by design (the stake-tier filter's hint, and again
  // below the results — see browse-filters.tsx) so this is deliberately not a strict match.
  await expect(managerB.getByText("No money changes hands.").first()).toBeVisible();

  // Filtering narrows, and the URL carries it.
  await managerB.getByLabel("Draft format").selectOption("auction");
  await managerB.getByRole("button", { name: "Show leagues" }).click();
  await expect(managerB).toHaveURL(/format=auction/);
  await expect(managerB.getByText("Rookie Snake Room")).toHaveCount(0);

  await managerB.getByRole("button", { name: /^Join / }).first().click();
  await expect(managerB).toHaveURL(/\/app\/leagues\//);
  await expect(managerB.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a signed-OUT visitor can browse but is asked to sign in before joining", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/browse");
  await expect(page.getByRole("heading", { name: "Open leagues" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to join" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^Join / })).toHaveCount(0);
  await context.close();
});
