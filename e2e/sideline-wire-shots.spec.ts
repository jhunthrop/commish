import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { and, eq, isNotNull } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { rosterSlots, tradeProposals } from "../src/db/schema";
import { proposalFingerprint } from "../src/league-service/trades";
import {
  E2E_TRADES_LEAGUE_ID,
  E2E_TRADES_TEAM_A_ID,
  E2E_TRADES_TEAM_B_ID,
  E2E_TRADES_WEEK_NUMBER,
  MANAGER_B_STATE,
} from "./global-setup";

/**
 * THE ROUND'S OWN SHOTS: the wire and the account room, at 1440 and 360, in both themes, against
 * the real build and the real database. Not an assertion suite — `sideline-wire.spec.ts` holds
 * the principles — this exists so a reviewer can see what actually shipped.
 *
 * `@screens` so it is trivially excluded from an ordinary run.
 */

const OUT = ".superpowers/mocks/screenshots";
const WIDTHS = [1440, 360] as const;
const THEMES = ["light", "dark"] as const;

const SEEDED_TRADE_ID = "e2e_sideline_wire_shot_offer";

/**
 * FIX ROUND 1, M4. A shot taken mid-entrance-spring shows half-faded elements sitting over each
 * other, which reads as a collision that is not there — the first `wire-360-light.png` showed the
 * clinched banner's figure over its own wrapped caption for exactly that reason. Wait for every
 * animation this document is running to finish (the breathing presence dot never does, so the
 * wait is bounded) before the shutter.
 */
async function settle(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async () => {
    const landing = document
      .getAnimations()
      .filter((animation) => (animation.effect as KeyframeEffect | null)?.getComputedTiming().iterations !== Infinity);
    await Promise.all(landing.map((animation) => animation.finished.catch(() => undefined)));
  });
  await page.waitForTimeout(250);
}

async function firstPlayerOn(db: ReturnType<typeof createDb>, teamId: string): Promise<string> {
  const rows = await db
    .select({ playerId: rosterSlots.playerId })
    .from(rosterSlots)
    .where(and(eq(rosterSlots.teamId, teamId), isNotNull(rosterSlots.playerId)))
    .limit(1);
  const playerId = rows[0]?.playerId;
  if (playerId === null || playerId === undefined) throw new Error(`no dealt player on ${teamId}`);
  return playerId;
}

test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  const db = createDb();
  try {
    await db.delete(tradeProposals).where(eq(tradeProposals.id, SEEDED_TRADE_ID));
    const proposerAssets = [{ kind: "player" as const, playerId: await firstPlayerOn(db, E2E_TRADES_TEAM_A_ID) }];
    const counterpartyAssets = [{ kind: "player" as const, playerId: await firstPlayerOn(db, E2E_TRADES_TEAM_B_ID) }];
    const now = new Date();
    await db.insert(tradeProposals).values({
      id: SEEDED_TRADE_ID,
      leagueId: E2E_TRADES_LEAGUE_ID,
      proposerTeamId: E2E_TRADES_TEAM_A_ID,
      counterpartyTeamId: E2E_TRADES_TEAM_B_ID,
      weekNumber: E2E_TRADES_WEEK_NUMBER,
      proposerAssets,
      counterpartyAssets,
      fingerprint: proposalFingerprint({
        leagueId: E2E_TRADES_LEAGUE_ID,
        proposerTeamId: E2E_TRADES_TEAM_A_ID,
        counterpartyTeamId: E2E_TRADES_TEAM_B_ID,
        proposerAssets,
        counterpartyAssets,
      }),
      note: "I need a back and you are three deep.",
      status: "open",
      proposedAt: now,
      expiresAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      settledAt: null,
      reversedAt: null,
    });
  } finally {
    await db.$client.end();
  }
});

test.afterAll(async () => {
  const db = createDb();
  try {
    await db.delete(tradeProposals).where(eq(tradeProposals.id, SEEDED_TRADE_ID));
  } finally {
    await db.$client.end();
  }
});

test.use({ storageState: MANAGER_B_STATE });

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test(`@screens the wire and the account room at ${width}, ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 780 });
      // THE PRODUCT'S OWN SWITCH, not a stamped attribute. `ThemeProvider` re-stamps `data-theme`
      // from its own store on mount, so an init script that only sets the attribute is overwritten
      // the moment React hydrates — which is how this file first produced two identical "light"
      // shots. Pressing the radio the account room actually ships persists the choice, and every
      // page after it inherits the real thing a reader would see.
      await page.goto("/app/profile");
      await page.getByRole("radio", { name: theme === "dark" ? "Dark" : "Light" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
      await settle(page);
      await page.screenshot({ path: `${OUT}/account-room-${width}-${theme}.png`, fullPage: true });

      await page.goto(`/app/leagues/${E2E_TRADES_LEAGUE_ID}/trades`);
      await expect(page.locator('[aria-label="Trades drawer"]').getByRole("article").first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await settle(page);
      await page.screenshot({ path: `${OUT}/wire-${width}-${theme}.png`, fullPage: width === 1440 });
    });
  }
}
