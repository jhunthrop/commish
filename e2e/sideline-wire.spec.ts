import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { and, eq, isNotNull } from "drizzle-orm";
import { createDb } from "@research-ts/db/client";
import { rosterSlots, tradeProposals } from "@/db/schema";
import { proposalFingerprint } from "../src/league-service/trades";
import {
  E2E_TRADES_LEAGUE_ID,
  E2E_TRADES_TEAM_A_ID,
  E2E_TRADES_TEAM_B_ID,
  E2E_TRADES_WEEK_NUMBER,
  MANAGER_B_STATE,
} from "./global-setup";

/**
 * THE WIRE, SIDELINE (wave two) — the trade room and the free-agent board, in both themes,
 * against the real production build and the real database.
 *
 * Manager B's sealed session, because B is the side of the seeded league that HOLDS a team and
 * can therefore see a wire at all. The spec asserts the round's own claims as principles, in the
 * first-principles document's words:
 *
 *   P1 — the person comes before the number: both parties render as managers with faces and
 *        names, and every free agent is a row with a face rather than a code.
 *   P2 — one figure larger than body text per object, and it names its basis in the same glance.
 *   P3 — exactly one solid verb per viewport.
 *   P4 — nothing moves on load except the live channel.
 *   P7 — no tips, no explainer sentences, no trading vocabulary.
 *
 * Both themes in one pass through `data-theme`, the attribute the theme switcher itself stamps,
 * so a rule that only holds in one palette fails here rather than in somebody's screenshot.
 *
 * NOTHING IS WRITTEN. This spec never proposes, accepts, declines or claims: `trades.spec.ts`
 * owns the write walk and reverses what it does. A read-only spec can run twice against the same
 * long-lived database and leave it exactly as it found it.
 */

const THEMES = ["light", "dark"] as const;

/** The one solid verb, by the class only `Button`'s `verb`/`primary` variant carries. */
const SOLID_VERB = '[class*="shadow-verb-glow"]';

/** Words this product does not use about players (`fantasy-words.source.test.ts`'s own list,
 *  asserted here against what a real page actually renders). */
const TRADING_WORDS = /\b(market|buy|sell|fade|stock)\b/i;

/**
 * THE SURFACE, NOT THE PAGE. A room route opens the drawer at full height OVER the league front,
 * which is still mounted underneath it with its own verbs and its own figures. Every assertion
 * below is scoped to the drawer's own region (`RoomDrawer`'s `aria-label`), because the front
 * page behind it belongs to another round and counting its buttons here would make this spec
 * fail on somebody else's change.
 */
function wire(page: Page, surface: "trades" | "players") {
  return page.locator(`[aria-label="${surface === "trades" ? "Trades" : "Players"} drawer"]`);
}

async function openWire(page: Page, surface: "trades" | "players"): Promise<void> {
  await page.goto(`/app/leagues/${E2E_TRADES_LEAGUE_ID}/${surface}`);
  await expect(wire(page, surface)).toBeVisible({ timeout: 20_000 });
}

/**
 * THE ONE ROW THIS SPEC WRITES, and it writes it in the database rather than through the UI.
 *
 * `trades.spec.ts` owns the propose-accept-reverse walk through real browsers and undoes what it
 * does; this spec is about what an OPEN offer LOOKS like, and a seeded row gives it a card in a
 * known state on every run without racing that spec's own writes. The id is this file's own, so
 * `afterAll` can delete exactly what it inserted and nothing else.
 */
const SEEDED_TRADE_ID = "e2e_sideline_wire_offer";

/** One real player off each team's dealt roster — never a name this file predicts. */
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

for (const theme of THEMES) {
  test.describe(`the wire, ${theme}`, () => {
    test.use({ storageState: MANAGER_B_STATE });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript((value) => {
        document.documentElement.setAttribute("data-theme", value);
      }, theme);
    });

    test("a trade is a conversation: both managers, the offer inside a bubble, one number with its basis", async ({ page }) => {
      await openWire(page, "trades");

      const cards = wire(page, "trades").getByRole("article");
      await expect(cards.first()).toBeVisible({ timeout: 20_000 });

      const card = cards.first();

      // P1: BOTH parties, as people. Two managers per card, each with a name beside the face —
      // `Manager` is the only way a face renders, so this is also the assertion that no card
      // draws a team name with nobody attached.
      const managers = card.getByTestId("manager");
      await expect(managers).toHaveCount(2);
      for (const manager of await managers.all()) {
        await expect(manager).not.toHaveText("");
      }

      // The offer sits INSIDE the message: one bubble per card, carrying the whole thing.
      await expect(card.getByTestId("message-bubble")).toHaveCount(1);

      // P2/P11: an OPEN offer carries exactly one figure, and its caption names the window it is
      // counting down from. A settled card carries none at all — there is nothing left to count —
      // which is why this is asserted as "at most one, and if there is one it names its basis".
      const figures = card.getByTestId("big-number");
      const figureCount = await figures.count();
      expect(figureCount).toBeLessThanOrEqual(1);
      if (figureCount === 1) {
        await expect(figures.first()).toContainText(/days? left, of \d+ days/);
      }
    });

    test("the trade room carries one solid verb, no tips and no trading words", async ({ page }) => {
      await openWire(page, "trades");
      const room = wire(page, "trades");
      await expect(room.getByRole("article").first()).toBeVisible({ timeout: 20_000 });

      // P3, COUNTED OVER THE SURFACE'S OWN REGION: exactly one solid verb, and it is Accept.
      const solid = room.locator(SOLID_VERB);
      await expect(solid).toHaveCount(1);
      await expect(solid).toHaveText("Accept");

      // P7: no tip triggers survive anywhere (`InfoTip` is deleted), and no `title` attribute
      // stands in for one on a real control.
      await expect(page.getByRole("button", { name: /^What is a|^What is your|^What is the/ })).toHaveCount(0);
      await expect(room.locator("[title]")).toHaveCount(0);

      const copy = (await room.innerText()).replace(/\s+/g, " ");
      expect(copy).not.toMatch(TRADING_WORDS);
      // The house copy rules, on rendered text rather than on source.
      expect(copy).not.toMatch(/[—;]/);
    });

    test("the free-agent board is people with one number and one verb, and absence reads as absence", async ({ page }) => {
      await openWire(page, "players");
      const board = wire(page, "players");

      const search = board.getByLabel("Search free agents");
      await expect(search).toBeVisible({ timeout: 20_000 });

      // The mock's 40px pill field, not a hairline box.
      await expect(search).toHaveClass(/rounded-pill/);
      await expect(search).toHaveClass(/border-edge/);

      // P1/P2: every row is a person with a face, and the one number beside them names its basis.
      const figures = board.getByTestId("big-number");
      await expect(figures.first()).toBeVisible();
      for (const figure of (await figures.all()).slice(0, 8)) {
        await expect(figure).toContainText(/projected this week|no projection this week/);
      }

      // ABSENCE IS ABSENCE. A search nobody matches says so in a sentence a person would say, and
      // draws no rows at all — never a skeleton, never a zero-filled placeholder row.
      await search.fill("zzzzzzzznobodyzzzzzzzz");
      await expect(board.getByText("Nobody on the wire matches that.")).toBeVisible({ timeout: 20_000 });
      await expect(board.getByTestId("big-number")).toHaveCount(0);
      await expect(board.getByRole("button", { name: "Claim" })).toHaveCount(0);
    });

    test("nothing on the wire moves on load except the live channel", async ({ page }) => {
      // P4's own test: load the screen, do nothing, and see whether anything is animating. The
      // breathing presence dot is the one exemption the principle names, and it is the only
      // element allowed to be running here.
      await openWire(page, "trades");
      await expect(wire(page, "trades").getByRole("article").first()).toBeVisible({ timeout: 20_000 });
      // Past the 480ms entrance any arriving element springs through, so a still-running
      // animation is a looping one rather than a landing one.
      await page.waitForTimeout(1_200);

      const running = await page.evaluate(() =>
        document
          .getAnimations()
          .filter((animation) => animation.playState === "running")
          .map((animation) => (animation.effect as KeyframeEffect | null)?.target?.getAttribute("data-testid") ?? "unnamed"),
      );
      for (const name of running) expect(name).toBe("presence-dot");
    });
  });
}
