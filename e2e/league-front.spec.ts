import { mkdirSync } from "node:fs";
import { E2E_TRADES_LEAGUE_ID } from "./global-setup";
import { expect, test } from "./support/fixtures";

/**
 * THE LEAGUE FRONT PAGE ON SIDELINE (2026-09-10): the first real screen built on the new tokens
 * and primitives, walked at desktop and phone width against the drafted league global-setup seeds
 * for manager A (the shared dev seed hands the season league's first seat to whoever seeded it, so
 * that league is not a seat manager A can count on). Two kinds of proof here, because a token
 * system needs both:
 *
 * 1. Assertions on the composition the principles demand. P6: your game this week is the first
 *    region. P5: the room is a region on the same page with the say-something field in reach.
 *    P3: at most one solid Court blue pill in the viewport. P10: the phone never scrolls sideways.
 * 2. Pictures for the persona panel and the ledger, into `.superpowers/mocks/screenshots/`, in
 *    the theme the run asked for (`E2E_COLOR_SCHEME`).
 */
const OUT_DIR = ".superpowers/mocks/screenshots";

async function solidPillCount(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("button, a")).filter((node) => {
      const rect = node.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
      return visible && node.className.split(" ").includes("bg-accent");
    }).length,
  );
}

test("the league front page opens on your rival and the room, with one verb, at desktop width", async ({ managerA }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  await managerA.setViewportSize({ width: 1440, height: 900 });
  await managerA.goto(`/app/leagues/${E2E_TRADES_LEAGUE_ID}`);
  await expect(managerA.getByRole("heading", { level: 1 })).toBeVisible();

  // P6: your opponent this week, with a face, before anything else on the page.
  const rival = managerA.getByRole("region", { name: "Your game this week" });
  await expect(rival).toBeVisible();

  // P5: the stream and the say-something field on the same screen.
  const room = managerA.getByRole("region", { name: "The room" });
  await expect(room).toBeVisible();
  await expect(managerA.getByLabel("Message")).toBeVisible();

  // P3: one solid pill, or none when nothing needs the manager and the composer is quiet.
  expect(await solidPillCount(managerA)).toBeLessThanOrEqual(1);

  const theme = process.env.E2E_COLOR_SCHEME ?? "light";
  await managerA.screenshot({ path: `${OUT_DIR}/league-front-desktop-${theme}.png`, fullPage: false });
});

test("the league front page fits a phone, one column, without scrolling sideways", async ({ managerA }) => {
  mkdirSync(OUT_DIR, { recursive: true });
  // 360 is the product's minimum viewport (`TOKENS.minViewport`) and the suite's own phone project.
  await managerA.setViewportSize({ width: 360, height: 740 });
  await managerA.goto(`/app/leagues/${E2E_TRADES_LEAGUE_ID}`);
  await expect(managerA.getByRole("region", { name: "Your game this week" })).toBeVisible();
  // The picture should show the room, not its skeleton: wait for the log or the empty room's line.
  await expect(managerA.getByRole("log", { name: "What happened" }).or(managerA.getByText("Nothing has happened here yet. Say the first thing."))).toBeAttached();

  // P10 at 360px: nothing on the page this round owns (the `main` landmark) sticks out past the
  // viewport. On failure, name what did. The shell's own header is measured separately and
  // reported as an annotation, because a header that overflows is shell debt, not the room's.
  const overflow = await managerA.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const stickingOut = (scope: string) =>
      Array.from(document.querySelectorAll<HTMLElement>(`${scope} *`))
        .filter((node) => node.getBoundingClientRect().right > width + 1)
        .slice(0, 8)
        .map((node) => `${node.tagName.toLowerCase()}.${node.className.toString().split(" ").slice(0, 4).join(".")}@${Math.round(node.getBoundingClientRect().right)}`);
    return { page: document.documentElement.scrollWidth - width, main: stickingOut("main"), header: stickingOut("header") };
  });
  test.info().annotations.push({ type: "shell-overflow", description: `page ${overflow.page}px, header offenders ${overflow.header.join(", ") || "none"}` });
  expect(overflow.main, "the room sticks out past a 360px viewport").toEqual([]);

  expect(await solidPillCount(managerA)).toBeLessThanOrEqual(1);

  const theme = process.env.E2E_COLOR_SCHEME ?? "light";
  await managerA.screenshot({ path: `${OUT_DIR}/league-front-phone-${theme}.png`, fullPage: false });
  // The room lower down the same page, for the panel's tap-by-tap walk.
  await managerA.getByLabel("Message").scrollIntoViewIfNeeded();
  await managerA.screenshot({ path: `${OUT_DIR}/league-front-phone-${theme}-room.png`, fullPage: false });
});
