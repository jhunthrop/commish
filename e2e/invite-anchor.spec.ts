import { expect, test } from "./support/fixtures";
import { MANAGER_A_STATE } from "./global-setup";

/**
 * Link audit, 2026-09-04 — the founder's report: "the invite link doesn't work from a created
 * league page." Root cause: `WaitingRoom`'s "Invite someone" links target `#invite-managers`,
 * and that block lived only inside `RoomShell`'s rail — an aside that is `hidden` below `xl`
 * (1280px). Below that width the click changed the hash and nothing else: the anchor existed
 * but was display:none, so the browser had nothing to scroll to and a commissioner had no way
 * to mint an invite at all. `league-lifecycle.spec.ts` never caught it because the suite's
 * Desktop Chrome viewport is exactly 1280 wide — the one width where the rail is just barely
 * on screen.
 *
 * This spec drives the SAME chain one pixel-class down (1200 wide): created league -> "Invite
 * someone" -> the panel actually appears -> mint -> the minted URL opens for a signed-out
 * recipient with the league's terms and a sign-in action. The signed-in join half of the chain
 * stays `league-lifecycle.spec.ts`'s job — one suite-wide owner per assertion.
 */
test("below the rail breakpoint, Invite someone reveals the panel and the minted URL lands for a stranger", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: MANAGER_A_STATE, viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();

  // Created through the real create route with the commissioner's own session — this spec is
  // about the created league's PAGE, not the create form (league-lifecycle owns that).
  const leagueName = `E2E Invite Anchor ${Date.now()}`;
  const createResponse = await context.request.post("/api/leagues", {
    data: { name: leagueName, teamCount: 8 },
  });
  expect(createResponse.ok()).toBe(true);
  const created = (await createResponse.json()) as { readonly data: { readonly leagueId: string } };
  const leagueId = created.data.leagueId;

  await page.goto(`/app/leagues/${leagueId}`);
  // The waiting room's own invite link — the exact control the founder pressed.
  await page.getByRole("link", { name: "Invite someone" }).first().click();
  // The regression: below xl this used to change the hash and reveal nothing.
  await page.getByRole("button", { name: "Create invite link" }).click();
  const inviteUrl = await page.getByLabel("Invite link").inputValue();
  expect(inviteUrl).toMatch(/^https?:\/\/[^/]+\/app\/join\//);
  await context.close();

  // A genuinely signed-out recipient follows the minted URL: the middleware exemption serves
  // the landing (no sign-in redirect), the terms render, and the one action is sign-in.
  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  const landing = await strangerPage.goto(inviteUrl);
  expect(landing?.status()).toBe(200);
  await expect(strangerPage.getByRole("heading", { name: "Join a league" })).toBeVisible();
  await expect(strangerPage.getByRole("heading", { name: leagueName })).toBeVisible();
  await expect(strangerPage.getByRole("link", { name: /sign in/i }).first()).toBeVisible();
  await stranger.close();
});
