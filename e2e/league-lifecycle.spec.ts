import type { Page } from "@playwright/test";
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
  // This is the one spec in the suite driving TWO real browser contexts through create, invite,
  // join, start-the-draft, a live pick's SSE fan-out, AND (Task 6) the report-resolve-tombstone
  // arc — two dozen-plus real navigations, not the handful every other spec makes. The DOM at
  // each step is healthy well inside the default budget on a quiet machine; under a shared
  // machine's contention (concurrent builds/tests from other work on the same checkout) the
  // cumulative page-load time alone can exceed the suite's default 90s, closing the context
  // mid-action with an unhelpful "target page ... has been closed" rather than a real product
  // failure. Scoped to only this test, not the global default every lighter spec still runs
  // under. 240s, not 180s: Task 6's own arc adds report, queue, resolve and two reloads on top
  // of everything the 180s budget was already sized for.
  test.setTimeout(240_000);

  const leagueName = `E2E League ${Date.now()}`;

  // --- Create, accepting every default except the size ------------------------------------
  await managerA.goto("/app");
  await expect(managerA.getByRole("heading", { name: "Your leagues" })).toBeVisible();
  // Manager A already has the seeded season league (`global-setup.ts`), so `firstRun` is null
  // and the create form is collapsed behind Task 5's disclosure rather than sitting on the page
  // by default — open it by name instead of assuming the form is already visible.
  await managerA.getByText("Start or join another league").click();
  // `exact`: a league card's action link is named "Invite managers for <league name>", so the
  // default substring match collides with any existing league whose own name contains the words
  // this field is labelled with.
  await managerA.getByLabel("League name", { exact: true }).fill(leagueName);
  await managerA.getByText(/Advanced settings/).click();
  // The smallest supported team count (src/league-room/components/create-league-form.tsx's
  // TEAM_COUNTS is [8, 10, 12, 14, 16] — there is no 4-team league).
  await managerA.getByLabel("Teams").selectOption("8");
  await managerA.getByRole("button", { name: "Create league" }).click();

  await expect(managerA.getByRole("heading", { name: leagueName })).toBeVisible();
  const leagueId = new URL(managerA.url()).pathname.split("/").pop()!;
  expect(leagueId).toBeTruthy();
  // Scoped to the page header: Task 8's terms panel now ALSO states the fill count (its own
  // "Size" row), so the bare substring is ambiguous — this locator names the header's own
  // "N of 8 managers · Snake draft" line specifically, not the terms panel's restatement of it.
  await expect(managerA.locator("header").getByText("1 of 8 managers")).toBeVisible();

  // --- Invite ------------------------------------------------------------------------------
  await managerA.getByRole("button", { name: "Create invite link" }).click();
  const invitePath = await managerA.getByLabel("Invite link").inputValue();
  expect(invitePath).toMatch(/^\/app\/join\//);

  // --- Join, as a genuinely different person ----------------------------------------------
  await managerB.goto(invitePath);
  // The button reads "Join <league name>" (`JoinForm`, Task 7's terms preview), not the static
  // "Join this league" this spec was still asserting on — a latent mismatch that predates Task 8
  // and only surfaced once the heading fix above let the test reach this far.
  await managerB.getByRole("button", { name: `Join ${leagueName}` }).click();
  // Wait for the NAVIGATION, not the heading: `LeagueTermsPanel` already renders the league name
  // as a heading on the invite preview itself, so `toBeVisible()` on it was satisfied the instant
  // the button was clicked and proved nothing about whether the join landed. `JoinForm` pushes to
  // the league page only after `POST /api/invites/[code]/accept` succeeds, so the url is the
  // first thing that actually depends on the write — and manager A's reload below races the same
  // write.
  // The league id is already in scope from the create step above, so this names the league
  // manager B was supposed to land in rather than accepting any league-shaped url.
  await expect(managerB).toHaveURL(new RegExp(`/app/leagues/${leagueId}$`));
  await expect(managerB.getByRole("heading", { name: leagueName })).toBeVisible();

  await managerA.reload();
  await expect(managerA.locator("header").getByText("2 of 8 managers")).toBeVisible();

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
  // it is. Identify that page by the rail's "You're on the clock" marker, which only the true
  // picker's page renders and only after hydration. Draft buttons are the WRONG discriminator:
  // the server-rendered pool briefly shows them on the waiting page too, so both an
  // instantaneous count() and a count-based poll could crown the waiting page, which then
  // correctly loses its buttons on hydration and hangs the spec to its timeout.
  const onClock = (page: Page) => page.getByText("You're on the clock").count();
  await expect
    .poll(async () => (await onClock(managerA)) + (await onClock(managerB)), { timeout: 30_000 })
    .toBeGreaterThan(0);
  const picker = (await onClock(managerA)) > 0 ? managerA : managerB;
  const watcher = picker === managerA ? managerB : managerA;
  // `span.font-display` alone also matches the position badge (e.g. "QB") next to the name —
  // `.truncate` is unique to the player-name span (see player-pool.tsx).
  await picker.getByRole("button", { name: "Draft" }).first().waitFor({ timeout: 15_000 });
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

  // Click-and-verify, retried: a server-rendered Draft button is visible and "stable" before
  // React attaches its handler, so a click that lands pre-hydration is a silent no-op (trace
  // evidence: no POST ever left the page). The picker's OWN pool losing the row is the click's
  // receipt — it folds locally from the action response, no SSE involved — so retrying until it
  // moves proves the click was real without weakening the watcher-side SSE assertion below.
  const pickerPool = picker.getByRole("list", { name: "Available players, best first" });
  // The click targets pickedName's OWN row, not ".first()": between reading the name and
  // clicking, the pool can reorder, and clicking a POSITION would then draft a different
  // player, hand the turn to the other team, and leave every retry dead against a buttonless
  // waiting-mode page.
  await expect(async () => {
    await pickerPool
      .getByRole("listitem")
      .filter({ hasText: pickedName })
      .getByRole("button", { name: "Draft" })
      .click();
    await expect(pickerPool.getByRole("listitem").filter({ hasText: pickedName })).toHaveCount(0, { timeout: 3_000 });
  }).toPass({ timeout: 30_000 });

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

  // --- And the pick reaches the member-visible activity feed too ---------------------------
  // Task 10's whole spine, end to end, in a browser: a real pick, through AuditLogger, into
  // the chain, out through the allowlist (Task 9), onto a page a member can read. The same
  // authenticated session that made the pick reads it back.
  await picker.goto(`/app/leagues/${leagueId}/activity`);
  await expect(picker.getByRole("heading", { name: "League activity" })).toBeVisible();
  await expect(picker.getByRole("listitem").filter({ hasText: "drafted" }).first()).toBeVisible();

  // --- Task 6's own arc: report -> operator resolves -> the room shows the tombstone --------
  // Manager A IS the operator, deterministically: `global-setup.ts`'s `ensureE2eOperator`
  // grants it through the real `grantAdmin` writer (see `mobile-360.spec.ts`'s own comment on
  // the same fact). Manager B posts the message so the reporter and the author are two
  // different real accounts, the same "two sessions, one real flag" shape the plan's own brief
  // describes for this arc.
  await managerA.goto(`/app/leagues/${leagueId}`);
  await managerB.goto(`/app/leagues/${leagueId}`);
  // `getByRole("textbox", ...)`, not `getByLabel`: by this point the log region itself carries
  // `aria-label="Messages"`, which a plain `getByLabel("Message")` substring-matches alongside
  // the composer's own "Message" label — unambiguous when chat was still empty (the original
  // chat assertion above), ambiguous now that a message already stands in it.
  const reportable = `Please remove me ${Date.now()}`;
  await managerB.getByRole("textbox", { name: "Message" }).fill(reportable);
  await managerB.getByRole("textbox", { name: "Message" }).press("Enter");

  const operatorLog = managerA.getByRole("log", { name: "Messages" });
  const reportableRow = operatorLog.getByRole("listitem").filter({ hasText: reportable });
  await expect(reportableRow.getByText(reportable)).toBeVisible({ timeout: 20_000 });

  // Click-and-verify, retried: a server-rendered "Report" button is visible and "stable"
  // before React attaches its handler, the same pre-hydration hazard the draft button above
  // documents.
  await expect(async () => {
    await reportableRow.getByRole("button", { name: "Report" }).click();
    await expect(managerA.getByRole("dialog", { name: "Report this message" })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 15_000 });
  await managerA.getByRole("button", { name: "Send report" }).click();
  await expect(managerA.getByText("Reported. An operator will take a look. Thank you.")).toBeVisible();
  await managerA.getByRole("button", { name: "Done" }).click();

  // --- The seeded operator opens the queue and sees this row, plus the ONE real flag Task 9's
  //     detector raises from `npm run seed`'s own multi-account fixture (`dev_league_integrity`
  //     — always open, since nothing in this spec resolves it) -----------------------------
  await managerA.goto("/app/admin/queue");
  await expect(managerA.getByRole("heading", { name: "Dispute queue" })).toBeVisible();
  const queueRows = managerA.getByRole("list", { name: "Open flags" }).getByRole("listitem");
  await expect(queueRows).toHaveCount(2);
  // Found by its own question text, not `.first()`: the seed's flag is OLDER than this spec's
  // own (the queue is oldest-first, ruling 30), so ordinal position would click the wrong row.
  const reportRow = queueRows.filter({ hasText: "A member reported a message" });
  await expect(reportRow).toHaveCount(1);
  await reportRow.getByRole("link").click();

  // --- Resolves it as content_removed, with a note that never reaches the member verbatim --
  await expect(managerA.getByText(reportable)).toBeVisible();
  await managerA.getByRole("radio", { name: "Remove the content" }).click();
  await managerA.getByLabel("Your note").fill("spam");
  await managerA.getByRole("button", { name: "Submit decision" }).click();
  // Not the form's own transient "Decision recorded" message: `router.refresh()` re-renders
  // the Server Component the instant the submit resolves, swapping `ResolutionForm` for
  // `ResolutionSummary` before a fixed-string wait can reliably catch the transient one. The
  // trail's own "removed the reported content" line is what survives that swap.
  await expect(managerA.getByText("removed the reported content").first()).toBeVisible();

  // --- The room shows the tombstone in place, not a hole (ruling 18) -----------------------
  // Back to the league page, not a reload of the admin detail page it just submitted from.
  await managerA.goto(`/app/leagues/${leagueId}`);
  await expect(operatorLog.getByText("A message was removed.")).toBeVisible({ timeout: 20_000 });
  await expect(operatorLog.getByText(reportable)).toHaveCount(0);
  // Fix round 1 (review adjudication, HIGH): the room sees ONLY the neutral fact — never the
  // removal reason. The operator's note above ("spam") maps to the closed vocabulary's own
  // "spam or fake content" phrase (`chatRemovalPhraseFor`); that phrase must not appear anywhere
  // in the room, even though the SAME phrase reaches the author privately, through their own
  // notice, asserted below. Inverted assertion, the same shape the notice-privacy guards use.
  await expect(operatorLog.getByText("spam or fake content")).toHaveCount(0);

  // --- And the author's own inbox carries the notice, WITH the reason, privately -----------
  await managerB.goto(`/app/leagues/${leagueId}`);
  await expect(async () => {
    await managerB.getByRole("button", { name: /^Notices/ }).click();
    await expect(managerB.getByRole("region", { name: "Notices" })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 15_000 });
  await expect(managerB.getByText("We removed one of your messages").first()).toBeVisible();
  // Founder decision #4 (fix round 1, panel HIGH): the notice says there is no appeal.
  await expect(managerB.getByText("There is no reply to this message.").first()).toBeVisible();
  // The private channel: the SAME phrase the room was never shown reaches the author here,
  // through their own notice's blockquote (`quoteFor`) — confirming the reason moved, not
  // vanished.
  await expect(managerB.getByText(/spam or fake content/).first()).toBeVisible();
});
