import type { Page } from "@playwright/test";
import { JOBS_CONFIG } from "../src/jobs/config";
import { MOCK_CONFIG } from "../src/mock-draft/config";
import { expect, test } from "./support/fixtures";

/**
 * A WHOLE 12-TEAM SOLO MOCK, PACED BY THE JOBS (draft-room performance round, item 3). The room
 * is created through the mock-draft API and opened in the browser; the human seat picks the top
 * of the board through the actions route the moment its turn arrives; every bot pick is one
 * queued job run in its own self-woken invocation, whether or not this tab were open. The proof
 * is the wire itself: every `draft.pick` frame's receipt instant is recorded at the browser's
 * `EventSource` (before the app's own listener), and no two consecutive BOT picks may arrive
 * within 300 ms of each other — the "hang, then two picks at once" of the Phase 1 report.
 *
 * Runs against a server started with `VERCEL=1`, `CRON_SECRET` and `JOBS_SELF_URL` pointing at
 * itself (the e2e runner's own environment), so the dev ticker is off and the jobs pace.
 */
const TEAM_COUNT = 12;
/** The room's clock: 60 by default, or `E2E_PICK_SECONDS` (90 exercises the wake chain, review finding 1). */
const PICK_SECONDS = Number(process.env.E2E_PICK_SECONDS ?? 60);
const HUMAN_SEAT = 7;
const MIN_BOT_GAP_MS = 300;
const HUMAN_THINK_MS = 1_500;
/** A clock longer than one wake's sleep (`JOBS_CONFIG.selfWakeMaxSleepMs`) is let run once. */
const LET_CLOCK_RUN_ABOVE_MS = JOBS_CONFIG.selfWakeMaxSleepMs;
/** One sleep slice past 0:00, plus the pick's own transaction and relay. */
const EXPIRY_SLACK_MS = JOBS_CONFIG.selfWakeSleepSliceMs + 2_000;
/** Every pick of a 12-team, full-roster mock, paced at the top of the delay window, plus slack. */
const DRAFT_TIMEOUT_MS = TEAM_COUNT * 16 * (MOCK_CONFIG.botDelay.baseMs + MOCK_CONFIG.botDelay.jitterMs) + 15 * HUMAN_THINK_MS + PICK_SECONDS * 1_000 + 120_000;

interface Frame {
  readonly t: number;
  readonly type: string;
  readonly pick: number | null;
  readonly team: string | null;
  readonly onClock: string | null;
  readonly phase: string | null;
}

const RECORDER = `(() => {
  const W = window;
  W.__pace = { frames: [] };
  const NativeES = W.EventSource;
  function WrappedES(url, init) {
    const es = new NativeES(url, init);
    for (const type of ["draft.pick", "draft.status", "draft.timer_expire"]) es.addEventListener(type, (e) => {
      let p = null; try { p = JSON.parse(e.data); } catch {}
      const pl = p && p.payload ? p.payload : {};
      W.__pace.frames.push({ t: performance.timeOrigin + performance.now(), type, pick: pl.pickNumber ?? null, team: pl.teamId ?? null, onClock: pl.clock ? pl.clock.onClockTeamId : null, phase: pl.clock ? pl.clock.phase ?? null : null });
    });
    return es;
  }
  WrappedES.prototype = NativeES.prototype;
  WrappedES.CONNECTING = 0; WrappedES.OPEN = 1; WrappedES.CLOSED = 2;
  W.EventSource = WrappedES;
})();`;

async function frames(page: Page): Promise<readonly Frame[]> {
  return page.evaluate(() => (window as unknown as { __pace: { frames: Frame[] } }).__pace.frames);
}

test("a 12-team solo mock drafts to completion on the jobs' pacing, every bot pick at least 300 ms from the next", async ({ managerA }) => {
  test.setTimeout(DRAFT_TIMEOUT_MS);
  await managerA.addInitScript(RECORDER);
  const created = await managerA.request.post("/api/mock-drafts", { data: { mode: "solo", teamCount: TEAM_COUNT, pickSeconds: PICK_SECONDS, draftSlot: HUMAN_SEAT } });
  const body = (await created.json()) as { readonly ok: boolean; readonly data?: { readonly draftId: string; readonly teamId: string } };
  if (!body.ok || body.data === undefined) throw new Error(`[e2e] could not open a solo mock: ${JSON.stringify(body)}`);
  const { draftId, teamId } = body.data;
  await managerA.goto(`/app/drafts/${draftId}`);
  await expect(managerA.getByTestId("quilt-room")).toBeVisible();

  let lastHumanPick = 0;
  // THE CLOCK THAT RUNS OUT (review finding 1): on a clock longer than one wake's sleep, the
  // human's first turn is left to expire, so the run proves the chained wake lands the expiry
  // within one slice of 0:00 rather than a cron minute later.
  const letFirstClockRun = PICK_SECONDS * 1_000 > LET_CLOCK_RUN_ABOVE_MS;
  let letRunDeadlineMs: number | null = null;
  const deadline = Date.now() + DRAFT_TIMEOUT_MS - 30_000;
  while (Date.now() < deadline) {
    const state = await managerA.request.get(`/api/drafts/${draftId}`);
    const snapshot = (await state.json()) as { readonly ok: boolean; readonly data: { readonly draft: { readonly phase: string; readonly onClockTeamId: string | null; readonly pickNumber: number; readonly deadlineAt: string | null; readonly availablePlayerIds: readonly string[] } } };
    const draft = snapshot.data.draft;
    if (draft.phase === "complete") break;
    if (draft.onClockTeamId === teamId && draft.pickNumber > lastHumanPick) {
      lastHumanPick = draft.pickNumber;
      if (letFirstClockRun && letRunDeadlineMs === null && draft.deadlineAt !== null) {
        letRunDeadlineMs = Date.parse(draft.deadlineAt);
        await managerA.waitForTimeout(250);
        continue;
      }
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

  const final = (await (await managerA.request.get(`/api/drafts/${draftId}`)).json()) as { readonly data: { readonly draft: { readonly phase: string; readonly picks: readonly unknown[] } } };
  expect(final.data.draft.phase).toBe("complete");

  const picks = (await frames(managerA)).filter((frame) => frame.pick !== null).sort((a, b) => a.pick! - b.pick!);
  // The room's whole board, less at most the picks landed before the stream opened.
  expect(picks.length).toBeGreaterThanOrEqual(final.data.draft.picks.length - TEAM_COUNT);
  const gaps: { pick: number; gapMs: number }[] = [];
  for (let i = 1; i < picks.length; i += 1) {
    const previous = picks[i - 1]!;
    const current = picks[i]!;
    if (previous.team === teamId || current.team === teamId) continue;
    gaps.push({ pick: current.pick!, gapMs: current.t - previous.t });
  }
  const tooClose = gaps.filter((gap) => gap.gapMs < MIN_BOT_GAP_MS);
  expect(tooClose, `bot picks landing within ${MIN_BOT_GAP_MS} ms of the previous: ${JSON.stringify(tooClose)}`).toEqual([]);
  expect(gaps.length).toBeGreaterThan(100);

  if (letRunDeadlineMs !== null) {
    const expiries = (await frames(managerA)).filter((frame) => frame.type === "draft.timer_expire" && frame.t >= letRunDeadlineMs! - 1_000);
    const expiry = expiries[0];
    expect(expiry, "the let-run clock never expired on the wire").toBeDefined();
    const lateMs = expiry!.t - letRunDeadlineMs;
    console.log(`[pace] the ${PICK_SECONDS} s clock that ran out expired ${Math.round(lateMs)} ms after 0:00 at the browser`);
    expect(lateMs).toBeGreaterThanOrEqual(-50);
    expect(lateMs).toBeLessThan(EXPIRY_SLACK_MS);
  }
});
