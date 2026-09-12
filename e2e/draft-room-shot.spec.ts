import { expect, test } from "./support/fixtures";

/**
 * THE PICTURE, NOT THE RULEBOOK. A one-shot harness that drives the real front door into a real
 * solo mock draft room and writes a PNG, so that "does the room look like the approved mock?"
 * can be answered by LOOKING rather than by arguing that each atom passes a rule.
 *
 * It exists because the previous pass at the broadcast-cut design shipped every part and none of
 * the feeling: five phases of rule-gated increments, each defensible, nobody holding the whole
 * composition against the picture. A screenshot is the only artifact that catches that.
 *
 * SKIPPED unless `DRAFT_ROOM_SHOT` is set. It is a design tool, not an assertion about the
 * product — it proves nothing and would only cost `npm run e2e` four minutes of bot-watching on
 * every run. To use it:
 *
 *   DRAFT_ROOM_SHOT=1 E2E_BASE_URL=http://localhost:3104 npx playwright test e2e/draft-room-shot.spec.ts
 *
 * (build first — `npm run e2e:build` — or you are photographing the past; see
 * `playwright.config.ts`'s own note on `next start` serving whatever is already on disk.)
 *
 * The journey is `mock-draft.spec.ts`'s own opening, deliberately: front door -> `/app/draft/mock-drafts`
 * -> a twelve-team solo room on the LAST draft slot -> wait for the human's turn. The last slot is
 * what makes the shot worth taking — eleven bot picks land before the human's first turn, so the
 * board, the pick wire and the run callout all have real history in them, and the rail is in its
 * `hot` state rather than the watching one. A screenshot of an empty room would flatter every
 * design equally.
 */
const TEAM_COUNT = 12;
/** The 90s tier, the same one `mock-draft.spec.ts` picks: long enough that the human's turn does
 *  not expire while the page is being photographed. */
const PICK_SECONDS = 90;
/** The shuffled draft order makes no promise about when bots finish, and eleven of them pick
 *  before the host on the last slot. Matches `mock-draft.spec.ts`'s own worst-case bound. */
const ON_CLOCK_TIMEOUT_MS = 240_000;

test("photograph the live draft room", async ({ managerA }) => {
  test.skip(process.env.DRAFT_ROOM_SHOT === undefined, "design tool; set DRAFT_ROOM_SHOT=1 to run");
  test.setTimeout(480_000);

  const out = process.env.DRAFT_ROOM_SHOT_PATH ?? "docs/research/2026-08-28-draft-room-shot.png";
  // A generous desktop, the width the composition is designed for. The room owns the viewport
  // (`RoomLayout`'s `100dvh` frame), so a `fullPage` shot and a viewport shot are the same
  // picture — this is the frame the founder sees.
  await managerA.setViewportSize({ width: 1680, height: 1050 });

  await managerA.goto("/");
  await managerA.getByRole("link", { name: "Try a mock draft" }).click();
  await expect(managerA).toHaveURL(/\/app\/mock-drafts$/);
  await managerA.getByLabel("Teams").selectOption(String(TEAM_COUNT));
  await managerA.getByLabel("Pick clock").selectOption(String(PICK_SECONDS));
  await managerA.getByLabel("Draft position").selectOption(String(TEAM_COUNT));
  await expect(async () => {
    await managerA.getByRole("button", { name: "Start mock draft" }).click();
    await expect(managerA).toHaveURL(/\/app\/drafts\//, { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });

  // The first-run coach marks are a real part of the product but not of this composition — a
  // modal over the room would photograph the modal.
  const gotIt = managerA.getByRole("button", { name: "Got it" });
  if ((await gotIt.count()) > 0) await gotIt.click();

  // The quilt (2026-09-02): the your-turn signal is the clock strip swelling amber — the old
  // rail's "You are on the clock" band no longer exists in a snake room.
  await expect(managerA.getByTestId("top-strip")).toHaveAttribute("data-turn", "yours", { timeout: ON_CLOCK_TIMEOUT_MS });
  // One second of settle: the pick that just landed is mid-celebration, and the countdown has
  // just re-based. Photographing between those two leaves a half-drawn band in the shot.
  await managerA.waitForTimeout(1_500);
  await managerA.screenshot({ path: out });
  console.log(`[shot] wrote ${out}`);
});
