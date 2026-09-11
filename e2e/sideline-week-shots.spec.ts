import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";

/**
 * THE WEEK SURFACES' PICTURES — the design-review harness for the Sideline week-surfaces round.
 * Photographs the two screens the round is judged on (the team page with its lineup editor, and
 * Sunday's live stage) in both themes at both widths, into `.superpowers/mocks/screenshots/`,
 * beside the static mocks they were built to.
 *
 * The same picture-not-rulebook idea as `quilt-shots.spec.ts`: a composition is the one thing a
 * unit test cannot see, and a screenshot in both themes at 1440 and 360 is what a persona walk and
 * a founder review are actually conducted against.
 *
 * IT FINDS ITS OWN LEAGUE rather than naming the seeded season one. The seeded league's team 1 is
 * claimed by whichever identity seeded it last, and on a shared database a round can arrive to
 * find manager A is not in it (`live-scoring.spec.ts` fails the same way when that happens). A
 * screenshot harness that dies on somebody else's seed is a harness nobody runs, so this walks
 * `/app` and photographs the first league this manager actually has a team in.
 *
 * SKIPPED unless `SIDELINE_SHOTS` is set — a design tool, not an assertion. To use it:
 *
 *   npm run e2e:build
 *   SIDELINE_SHOTS=1 dotenv -e .env.local -v STATS_PROVIDER=mock -- npx playwright test e2e/sideline-week-shots.spec.ts
 */
const OUT_DIR = ".superpowers/mocks/screenshots";
const THEME_STORAGE_KEY = "commish.theme";
const WIDTHS = [
  { name: "1440", width: 1440, height: 1000 },
  { name: "360", width: 360, height: 800 },
] as const;
const THEMES = ["light", "dark"] as const;

/** Set the stored theme and wait for the root to actually carry it — the real returning-visitor
 *  path (`theme-provider.tsx`'s own storage key), not a `data-theme` poke the provider would
 *  overwrite on its next render. */
async function setThemeAndSettle(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.evaluate(({ key, t }) => window.localStorage.setItem(key, t), { key: THEME_STORAGE_KEY, t: theme });
  await page.reload();
  await page.waitForFunction((t) => document.documentElement.getAttribute("data-theme") === t, theme, { timeout: 10_000 });
  // The theme transition animates rather than snapping; one settle frame keeps a half-crossfaded
  // ground out of the picture.
  await page.waitForTimeout(600);
}

/** Every league id this manager has a team in, newest first, read off the rail's own rows. */
async function myLeagueIds(page: Page): Promise<readonly string[]> {
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Your leagues" })).toBeVisible();
  const hrefs = await page.getByRole("list", { name: "Your leagues" }).getByRole("link").evaluateAll((links) =>
    links.map((link) => (link as HTMLAnchorElement).getAttribute("href") ?? ""),
  );
  const ids = hrefs.map((href) => /^\/app\/leagues\/([^/#]+)/.exec(href)?.[1]).filter((id): id is string => id !== undefined);
  return [...new Set(ids)];
}

test("photograph the team page and Sunday's stage in both themes at both widths", async ({ managerA }) => {
  test.skip(process.env.SIDELINE_SHOTS === undefined, "design tool; set SIDELINE_SHOTS=1 to run");
  test.setTimeout(420_000);

  const leagueIds = await myLeagueIds(managerA);
  expect(leagueIds.length).toBeGreaterThan(0);

  // The first league whose team page has a real lineup editor on it, and the first whose room is
  // showing the live stage. They are usually different leagues, and either may be absent on a
  // database somebody else seeded last.
  let teamLeagueId: string | null = null;
  let liveLeagueId: string | null = null;
  for (const id of leagueIds) {
    if (teamLeagueId === null) {
      await managerA.goto(`/app/leagues/${id}/team`);
      if ((await managerA.getByRole("heading", { name: /lineup$/ }).count()) > 0) teamLeagueId = id;
    }
    if (liveLeagueId === null) {
      await managerA.goto(`/app/leagues/${id}`);
      if ((await managerA.getByTestId("score-bug").count()) > 0) liveLeagueId = id;
    }
    if (teamLeagueId !== null && liveLeagueId !== null) break;
  }
  expect(teamLeagueId, "no league on this database has a lineup editor for this manager").not.toBeNull();

  for (const viewport of WIDTHS) {
    for (const theme of THEMES) {
      await managerA.setViewportSize({ width: viewport.width, height: viewport.height });

      // THE TEAM PAGE: the weekly chore, one verb.
      await managerA.goto(`/app/leagues/${teamLeagueId}/team`);
      await setThemeAndSettle(managerA, theme);
      await expect(managerA.getByRole("heading", { name: /lineup$/ })).toBeVisible();
      await managerA.screenshot({ path: `${OUT_DIR}/team-page-${viewport.name}-${theme}.png`, fullPage: true });

      // SUNDAY'S STAGE: the borrowed bug and the borrowed lower third. Only when a league on this
      // database is actually mid-week; a still Sunday is a state, not a failure.
      if (liveLeagueId === null) continue;
      await managerA.goto(`/app/leagues/${liveLeagueId}`);
      await setThemeAndSettle(managerA, theme);
      await expect(managerA.getByTestId("score-bug")).toBeVisible();
      await managerA.screenshot({ path: `${OUT_DIR}/sunday-stage-${viewport.name}-${theme}.png`, fullPage: true });
    }
  }
});
