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

  // The fork itself: a headline, the plain-language explainer (guided help only), and all three
  // paths present, in the beginner order browse leads.
  await expect(managerZero.getByText(/A league is a group of managers/)).toBeVisible();
  const headings = managerZero.getByRole("heading", { level: 3 });
  await expect(headings).toHaveText(["Find an open league", "Join with an invite", "Start a league"]);

  // Guidance is ordering, never removal — the other two paths' real controls are on the page
  // too, not hidden behind the one this test follows.
  await expect(managerZero.getByLabel("Invite link or code")).toBeVisible();
  await expect(managerZero.getByLabel("League name")).toBeVisible();

  // The old always-on wall (its own "Invited by a friend?" / "No group to play with yet?"
  // section headings) is gone for a zero-leagues manager — the fork already is those sections.
  await expect(managerZero.getByRole("heading", { name: "Invited by a friend?" })).toHaveCount(0);
  await expect(managerZero.getByText("Start or join another league")).toHaveCount(0);

  await managerZero.getByRole("link", { name: "Browse open leagues" }).click();
  await expect(managerZero).toHaveURL(/\/browse$/);
  await expect(managerZero.getByRole("heading", { name: "Open leagues" })).toBeVisible();
});
