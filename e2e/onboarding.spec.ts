import { expect, test } from "./support/fixtures";

/**
 * THE ZERO-LEAGUE STATE, SIDELINE (2026-09-11). The first-run fork this spec used to walk — a
 * three-path panel explaining create, join and browse, with an identity card above it — is
 * deleted along with the `firstRunPlan` that chose it. The lobby answers a manager with no
 * leagues better than an explainer ever did: it is full of real rooms with real seat counts, its
 * featured room carries the page's single solid verb, and the create door sits beside the page's
 * own heading where a commissioner will look for it.
 *
 * `managerZero` (`e2e/support/fixtures.ts`) is the stable identity `global-setup` mints and warms
 * but neither the seed script nor any other spec ever joins or creates a league for, so this is
 * the real zero-league page through a real signed-in session and the real production build.
 */
test("a manager with zero leagues gets the lobby as the page, with one solid verb and a create door", async ({
  managerZero,
}) => {
  await managerZero.goto("/app");
  await expect(managerZero.getByRole("heading", { name: "Your leagues" })).toBeVisible();

  // No cards, because there are no leagues — and no explainer panel standing in their place.
  await expect(managerZero.getByTestId("home-league-card")).toHaveCount(0);
  await expect(managerZero.getByText(/A league is a group of managers/)).toHaveCount(0);
  await expect(managerZero.getByRole("heading", { name: "Set up your manager profile" })).toHaveCount(0);

  // The create door, always reachable, carrying the anchor every "start your own league" link in
  // the product points at (`/app#create-league`).
  const door = managerZero.locator("#create-league");
  await expect(door).toBeVisible();
  await expect(door).toHaveText("Create a league");

  // THE LOBBY IS THE PAGE: named, ordered, with its own way through to the whole of it.
  const lobby = managerZero.getByTestId("open-rooms");
  await expect(lobby).toBeVisible();
  await expect(lobby.getByRole("heading", { name: "Open rooms" })).toBeVisible();

  // P3, counted over what is actually ON SCREEN: the lobby renders each room twice, once as an
  // lg+ row and once as a sub-lg card, and only one of the two is ever visible at a given width.
  // `:visible` is the honest count of "solid buttons a reader can see".
  const solid = managerZero.locator('[class*="shadow-verb-glow"]:visible');
  await expect(solid).toHaveCount(1);
  await expect(solid).toHaveText(/Take a seat|Take the last seat/);

  await managerZero.getByRole("link", { name: "See every open league" }).click();
  await expect(managerZero).toHaveURL(/\/browse$/);
  await expect(managerZero.getByRole("heading", { name: "Open leagues" })).toBeVisible();
});

/**
 * The other half of the fork, and the reason it could be deleted: a manager WITH a seat gets
 * their league as a card with the people in it named, not a panel about how leagues work.
 */
test("a seated manager gets their league as a card, with the people in it named", async ({ managerD }) => {
  await managerD.goto("/app");
  const cards = managerD.getByTestId("home-league-card");
  await expect(cards).toHaveCount(1);
  // P1: the faces, with a sentence naming who is in — the thing the panel never said.
  await expect(cards.first().getByTestId("manager-stack")).toContainText(/are in\.|You are in\./);
  // P2: one figure on the card, and its caption names what it is.
  await expect(cards.first().getByTestId("big-number")).toHaveCount(1);
  // The create door is still there for a manager who already has one.
  await expect(managerD.locator("#create-league")).toBeVisible();
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
