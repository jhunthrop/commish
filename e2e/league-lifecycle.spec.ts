import { expect, test } from "./support/fixtures";

/**
 * Create -> invite -> join -> draft -> live fan-out, through the real UI, in two real browser
 * contexts.
 *
 * This spec deliberately does NOT run a draft to completion: a full sixteen-round draft on the
 * clock is minutes of real time and proves nothing the `src/integration/**` suite has not
 * already proved deterministically. What only a browser can prove is the part that suite
 * cannot touch at all: that a pick made in one browser reaches another browser over Redis
 * Streams and SSE, with no reload and no polling. That is the assertion this spec exists for.
 */
test("a commissioner creates a league, a second manager joins it, and a pick reaches them live", async ({
  managerA,
  managerB,
}) => {
  const leagueName = `E2E League ${Date.now()}`;

  // --- Create, accepting every default except the size ------------------------------------
  await managerA.goto("/app");
  await expect(managerA.getByRole("heading", { name: "Your leagues" })).toBeVisible();
  // Manager A already has the seeded season league (`global-setup.ts`), so `firstRun` is null
  // and the create form is collapsed behind Task 5's disclosure rather than sitting on the page
  // by default — open it by name instead of assuming the form is already visible.
  await managerA.getByText("Start or join another league").click();
  await managerA.getByLabel("League name").fill(leagueName);
  await managerA.getByText(/Advanced settings/).click();
  // The smallest supported team count (src/league-room/components/create-league-form.tsx's
  // TEAM_COUNTS is [8, 10, 12, 14, 16] — there is no 4-team league).
  await managerA.getByLabel("Teams").selectOption("8");
  await managerA.getByRole("button", { name: "Create league" }).click();

  await expect(managerA.getByRole("heading", { name: leagueName })).toBeVisible();
  const leagueId = new URL(managerA.url()).pathname.split("/").pop()!;
  expect(leagueId).toBeTruthy();
  await expect(managerA.getByText("1 of 8 managers")).toBeVisible();

  // --- Invite ------------------------------------------------------------------------------
  await managerA.getByRole("button", { name: "Create invite link" }).click();
  const invitePath = await managerA.getByLabel("Invite link").inputValue();
  expect(invitePath).toMatch(/^\/app\/join\//);

  // --- Join, as a genuinely different person ----------------------------------------------
  await managerB.goto(invitePath);
  await managerB.getByRole("button", { name: "Join this league" }).click();
  await expect(managerB.getByRole("heading", { name: leagueName })).toBeVisible();

  await managerA.reload();
  await expect(managerA.getByText("2 of 8 managers")).toBeVisible();

  // --- Open the draft ----------------------------------------------------------------------
  // No UI starts a draft yet (see the plan's open questions), so this drives the REAL
  // commissioner-only route with the REAL session cookie the context already carries. It is
  // the same HTTP request a future button will make, not a test-only door.
  await managerA.goto(`/app/leagues/${leagueId}`);
  const draftHref = await managerA.getByRole("link", { name: "Open the draft room" }).getAttribute("href");
  const draftId = draftHref!.split("/").pop()!;
  const started = await managerA.request.post(`/api/drafts/${draftId}/start`);
  expect(started.ok()).toBe(true);

  // --- Both managers watch the same board -------------------------------------------------
  await managerA.goto(`/app/drafts/${draftId}`);
  await managerB.goto(`/app/drafts/${draftId}`);
  await expect(managerA.getByLabel("Player pool")).toBeVisible();
  await expect(managerB.getByLabel("Player pool")).toBeVisible();

  // `RoomTour` (`@/draft-room/components/room-tour.tsx`) shows once, the first time a manager
  // EVER opens a draft room, and covers the board behind a modal until dismissed — unrelated to
  // this task's own fork, but it blocks the "Draft" click below the same way any other manager
  // hitting a fresh room for the first time would see it. Dismiss it for whichever of the two
  // stable e2e identities has never opened one before; a manager past their first room sees
  // nothing here, so this is a no-op for them.
  for (const manager of [managerA, managerB]) {
    const gotIt = manager.getByRole("button", { name: "Got it" });
    if ((await gotIt.count()) > 0) await gotIt.click();
  }

  // Whoever is on the clock drafts the top available player. The pick button only exists on
  // the page whose turn it is, which is itself the assertion that the room knows whose turn
  // it is.
  const picker = (await managerA.getByRole("button", { name: "Draft" }).count()) > 0 ? managerA : managerB;
  const watcher = picker === managerA ? managerB : managerA;
  // `span.font-display` alone also matches the position badge (e.g. "QB") next to the name —
  // `.truncate` is unique to the player-name span (see player-pool.tsx).
  const pickedName = await picker
    .getByRole("listitem")
    .filter({ has: picker.getByRole("button", { name: "Draft" }) })
    .first()
    .locator("span.truncate.font-display")
    .innerText();

  // Scoped to the watcher's OWN available-pool list (player-pool.tsx's `aria-label="Available
  // players, best first"` `<ol>`), not the whole page: every available player's name already
  // renders there before any pick happens, so a page-wide text match would resolve at t=0
  // whether or not anything reached the watcher over Redis Streams and SSE. Asserting the row
  // is present here first is what makes the disappearance below unable to pass vacuously.
  const watcherPool = watcher.getByRole("list", { name: "Available players, best first" });
  await expect(watcherPool.getByRole("listitem").filter({ hasText: pickedName })).toHaveCount(1);

  await picker.getByRole("button", { name: "Draft" }).first().click();

  // THE assertion: the pick reached the other browser with no reload and no polling. The row
  // only leaves this list when `view.availablePlayerIds` changes (player-pool.tsx filters
  // `showDrafted || !row.drafted`, and `showDrafted` defaults false) — which only happens when
  // an event arrives over the real-time stream.
  await expect(watcherPool.getByRole("listitem").filter({ hasText: pickedName })).toHaveCount(0, { timeout: 20_000 });

  // --- And so does a chat message ----------------------------------------------------------
  // Scoped to the message log region (message-list.tsx's `role="log" aria-label="Messages"`),
  // not the whole page, for the same anchoring rigor as the pool assertion above — even though
  // `shout` is a unique, freshly-generated string that could not already be on the page.
  const shout = `Nice pick ${Date.now()}`;
  await watcher.getByLabel("Message").fill(shout);
  await watcher.getByLabel("Message").press("Enter");
  const pickerLog = picker.getByRole("log", { name: "Messages" });
  await expect(pickerLog.getByText(shout)).toBeVisible({ timeout: 20_000 });
});
