import type { Page } from "@playwright/test";
import { MOCK_CONFIG } from "../src/mock-draft/config";
import { expect, test } from "./support/fixtures";

/**
 * A WHOLE 12-TEAM SOLO MOCK, THE BOTS BATCHED AND REVEALED ON TIME (the batched bots round,
 * 2026-09-25). The room is created through the mock-draft API and opened in the browser; the
 * human seat picks the top of the board through the actions route the moment its turn is
 * REVEALED (the top strip says so); every bot pick behind it is committed in that pick's own
 * request and revealed by the room at its seeded instant. The proof is the wall itself: every
 * tile's arrival on the board is recorded by a MutationObserver, and no two consecutive BOT
 * tiles may land within 300 ms of each other at the browser (the founder's "hang, then two picks
 * at once"), whatever the wire delivered in one breath.
 *
 * Runs against a server started with `VERCEL=1` (the e2e runner's own environment): no ticker,
 * no jobs, the pick's own request is the room's whole driver.
 */
const TEAM_COUNT = 12;
const PICK_SECONDS = Number(process.env.E2E_PICK_SECONDS ?? 60);
const HUMAN_SEAT = 7;
const MIN_BOT_GAP_MS = 300;
const HUMAN_THINK_MS = 1_500;
/** Every pick of a 12-team, full-roster mock, revealed at the top of the delay window, plus slack. */
const DRAFT_TIMEOUT_MS = TEAM_COUNT * 16 * (MOCK_CONFIG.botDelay.baseMs + MOCK_CONFIG.botDelay.jitterMs) + 15 * HUMAN_THINK_MS + 120_000;

interface Reveal {
  readonly t: number;
  /** The tile's accessible name: "<player>, pick <round>.<slot>". */
  readonly label: string;
}

const RECORDER = `(() => {
  const W = window;
  W.__reveals = { list: [], seen: new Set() };
  const note = (node) => {
    if (!(node instanceof Element)) return;
    const cells = node.matches('[data-testid="quilt-pick-cell"]') ? [node] : Array.from(node.querySelectorAll('[data-testid="quilt-pick-cell"]'));
    for (const cell of cells) {
      const label = cell.getAttribute("aria-label") ?? "";
      if (W.__reveals.seen.has(label)) continue;
      W.__reveals.seen.add(label);
      W.__reveals.list.push({ t: performance.timeOrigin + performance.now(), label });
    }
  };
  const start = () => new MutationObserver((records) => { for (const r of records) r.addedNodes.forEach(note); }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.documentElement) start(); else document.addEventListener("DOMContentLoaded", start);
})();`;

async function reveals(page: Page): Promise<readonly Reveal[]> {
  return page.evaluate(() => (window as unknown as { __reveals: { list: Reveal[] } }).__reveals.list);
}

/** "Name, pick 2.05" in a 12-seat room is global pick 17. */
function pickNumberOf(label: string): number | null {
  const match = /pick (\d+)\.(\d+)$/.exec(label);
  return match === null ? null : (Number(match[1]) - 1) * TEAM_COUNT + Number(match[2]);
}

test("a 12-team solo mock drafts to completion with its bots batched, every bot tile at least 300 ms from the next", async ({ managerA }) => {
  test.setTimeout(DRAFT_TIMEOUT_MS);
  await managerA.addInitScript(RECORDER);
  const created = await managerA.request.post("/api/mock-drafts", { data: { mode: "solo", teamCount: TEAM_COUNT, pickSeconds: PICK_SECONDS, draftSlot: HUMAN_SEAT } });
  const body = (await created.json()) as { readonly ok: boolean; readonly data?: { readonly draftId: string; readonly teamId: string } };
  if (!body.ok || body.data === undefined) throw new Error(`[e2e] could not open a solo mock: ${JSON.stringify(body)}`);
  const { draftId, teamId } = body.data;
  await managerA.goto(`/app/drafts/${draftId}`);
  await expect(managerA.getByTestId("quilt-room")).toBeVisible();
  const strip = managerA.getByTestId("top-strip");

  let lastHumanPick = 0;
  const deadline = Date.now() + DRAFT_TIMEOUT_MS - 30_000;
  while (Date.now() < deadline) {
    // The room's own word on whose turn it is: the strip flips to "yours" only once every bot
    // before the human has been revealed, never at the commit.
    if ((await strip.getAttribute("data-turn")) !== "yours") {
      const state = await managerA.request.get(`/api/drafts/${draftId}`);
      const snapshot = (await state.json()) as { readonly data: { readonly draft: { readonly phase: string } } };
      if (snapshot.data.draft.phase === "complete") break;
      await managerA.waitForTimeout(250);
      continue;
    }
    const state = await managerA.request.get(`/api/drafts/${draftId}`);
    const snapshot = (await state.json()) as { readonly ok: boolean; readonly data: { readonly draft: { readonly phase: string; readonly onClockTeamId: string | null; readonly pickNumber: number; readonly availablePlayerIds: readonly string[] } } };
    const draft = snapshot.data.draft;
    if (draft.phase === "complete") break;
    if (draft.onClockTeamId === teamId && draft.pickNumber > lastHumanPick) {
      lastHumanPick = draft.pickNumber;
      await managerA.waitForTimeout(HUMAN_THINK_MS);
      // The best man the roster can still take: late in the draft only a kicker or a defense
      // fits (the must-pick line), and the board's top name is refused, so walk the board.
      let landed = false;
      for (const playerId of draft.availablePlayerIds.slice(0, 80)) {
        const picked = await managerA.request.post(`/api/drafts/${draftId}/actions`, { data: { type: "MAKE_PICK", playerId } });
        if (((await picked.json()) as { readonly ok: boolean }).ok) {
          landed = true;
          break;
        }
      }
      expect(landed, `human pick ${draft.pickNumber}`).toBe(true);
    }
    await managerA.waitForTimeout(250);
  }

  const final = (await (await managerA.request.get(`/api/drafts/${draftId}`)).json()) as { readonly data: { readonly draft: { readonly phase: string; readonly picks: readonly { readonly pickNumber: number; readonly teamId: string }[] } } };
  expect(final.data.draft.phase).toBe("complete");
  // The last batch reveals after the log completes: wait for the wall to catch up.
  await expect.poll(async () => (await reveals(managerA)).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(final.data.draft.picks.length - TEAM_COUNT);

  const teamOf = new Map(final.data.draft.picks.map((pick) => [pick.pickNumber, pick.teamId]));
  const tiles = (await reveals(managerA))
    .map((reveal) => ({ t: reveal.t, pick: pickNumberOf(reveal.label) }))
    .filter((tile): tile is { readonly t: number; readonly pick: number } => tile.pick !== null)
    .sort((a, b) => a.pick - b.pick);
  const gaps: { pick: number; gapMs: number }[] = [];
  for (let i = 1; i < tiles.length; i += 1) {
    const previous = tiles[i - 1]!;
    const current = tiles[i]!;
    if (current.pick !== previous.pick + 1 || teamOf.get(previous.pick) === teamId || teamOf.get(current.pick) === teamId) continue;
    gaps.push({ pick: current.pick, gapMs: current.t - previous.t });
  }
  const tooClose = gaps.filter((gap) => gap.gapMs < MIN_BOT_GAP_MS);
  expect(tooClose, `bot tiles landing within ${MIN_BOT_GAP_MS} ms of the previous: ${JSON.stringify(tooClose)}`).toEqual([]);
  expect(gaps.length).toBeGreaterThan(100);
});
