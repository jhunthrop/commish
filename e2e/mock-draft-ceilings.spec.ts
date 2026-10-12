import type { Position } from "@research/domain/player";
import { STANDARD_ROSTER_SLOTS } from "@research/domain/roster";
import { bestAvailableFor, positionCeiling, totalRosterSlots, AUTOPICK_CONFIG, type DraftState } from "../src/draft-engine";
import { draftStoreForE2e, setTableChip } from "./support/mock-room";
import { expect, test } from "./support/fixtures";

/**
 * The 2026-09-12 draft engine round, founder ruling: the practice bots draft under the same
 * roster-need ceilings as the clock, so a bot never holds three of a position the league starts
 * one of. Proven on the real stack: a twelve-team solo room drafted to completion LIVE, every bot
 * pick the running server's own bot driver's seeded draw, the browser open in the room
 * throughout, and every bot roster read back from the store. The host's own picks go through
 * the room's actions route with the browser's session, so the RUNNING SERVER applies them: a
 * write from this test's own process (as `mock-draft.spec.ts`'s fast-forward does once the
 * room's live beats are proven) leaves the server's cached state behind, and its bot driver then
 * folds picks on a state missing them, which is exactly the log this spec must not produce. The
 * host's live click is `mock-draft.spec.ts`'s proof; this spec is about the eleven seats around it.
 *
 * No ordering dependency on any other spec: the room is minted here through the real UI and
 * self-expires through `MOCK_CONFIG.retention`.
 */
const TEAM_COUNT = 12;
const ROUNDS = totalRosterSlots(STANDARD_ROSTER_SLOTS);
/** Eleven bots at under a second a pick, the host's fifteen live clicks, and real scheduler slack. */
const DRAFT_TIMEOUT_MS = 420_000;

test("a solo room drafted to completion live: no bot holds three quarterbacks or three tight ends, nor two kickers or defenses", async ({ managerA }) => {
  test.setTimeout(DRAFT_TIMEOUT_MS + 60_000);

  await managerA.goto("/app/mock-drafts");
  await setTableChip(managerA, "teams", "Teams", String(TEAM_COUNT));
  await setTableChip(managerA, "clock", "Pick clock", "90s");
  await setTableChip(managerA, "seat", "Your seat", String(TEAM_COUNT));
  await expect(async () => {
    await managerA.getByRole("button", { name: "Start mock draft" }).click();
    await expect(managerA).toHaveURL(/\/app\/drafts\//, { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });
  const draftId = new URL(managerA.url()).pathname.split("/").pop()!;
  const gotIt = managerA.getByRole("button", { name: "Got it" });
  if ((await gotIt.count()) > 0) await gotIt.click();

  // Drive the host's own turns until the room completes: the bots pick around it on their own.
  const store = draftStoreForE2e();
  const startedAt = Date.now();
  let state = await store.getDraftState(draftId);
  if (state === null) throw new Error(`[e2e] draft ${draftId} does not exist.`);
  const hostSeat = state.draftOrder[TEAM_COUNT - 1]!;
  while (state.phase !== "complete") {
    if (Date.now() - startedAt > DRAFT_TIMEOUT_MS) throw new Error(`[e2e] draft ${draftId} did not complete within ${DRAFT_TIMEOUT_MS}ms (pick ${state.pickNumber}).`);
    const onClock = state.pickNumber <= TEAM_COUNT * ROUNDS ? state.draftOrder[snakeIndex(state.pickNumber)] : null;
    if (onClock === hostSeat && state.phase === "in_progress") await postHostPick(managerA, draftId, state, hostSeat);
    else await managerA.waitForTimeout(500);
    const next = await store.getDraftState(draftId);
    if (next === null) throw new Error(`[e2e] draft ${draftId} disappeared mid-draft.`);
    state = next;
  }

  const positionOf = new Map(state.pool.map((entry) => [entry.playerId, entry.position] as const));
  const ceilings = AUTOPICK_CONFIG.rosterCeilings!;
  for (const teamId of state.draftOrder) {
    if (teamId === hostSeat) continue;
    const counts = new Map<Position, number>();
    for (const spot of state.rosters[teamId] ?? []) {
      const position = positionOf.get(spot.playerId!)!;
      counts.set(position, (counts.get(position) ?? 0) + 1);
    }
    expect((state.rosters[teamId] ?? []).length, `${teamId} filled its roster`).toBe(ROUNDS);
    expect(counts.get("QB") ?? 0, `${teamId} quarterbacks`).toBeLessThanOrEqual(2);
    expect(counts.get("TE") ?? 0, `${teamId} tight ends`).toBeLessThanOrEqual(2);
    expect(counts.get("K") ?? 0, `${teamId} kickers`).toBeLessThanOrEqual(1);
    expect(counts.get("DEF") ?? 0, `${teamId} defenses`).toBeLessThanOrEqual(1);
    for (const [position, count] of counts) expect(count, `${teamId} ${position}`).toBeLessThanOrEqual(positionCeiling(position, STANDARD_ROSTER_SLOTS, ceilings));
  }
  // Every pick was a seat's own MAKE_PICK, never the clock's: the room drafted itself live.
  expect(state.picks.every((pick) => !pick.auto)).toBe(true);
});

/**
 * The host's turn: the clock policy's own choice (`bestAvailableFor`, a pure read of the log),
 * posted as the host's MAKE_PICK through the room's actions route with the browser's session,
 * so the running server applies it. A refusal other than "not your turn" (a bot landed first,
 * the loop re-reads) is a real failure.
 */
async function postHostPick(page: import("@playwright/test").Page, draftId: string, state: DraftState, hostSeat: string): Promise<void> {
  const choice = bestAvailableFor(state, hostSeat);
  if (choice === null) throw new Error(`[e2e] nothing legal left for the host at pick ${state.pickNumber}.`);
  const response = await page.request.post(`/api/drafts/${draftId}/actions`, { data: { type: "MAKE_PICK", playerId: choice.playerId } });
  if (response.ok()) return;
  const body = (await response.json()) as { readonly error?: string };
  if (body.error !== "It's not your turn to pick." && body.error !== "That player has already been drafted.") {
    throw new Error(`[e2e] the host's MAKE_PICK at ${state.pickNumber} was refused: ${response.status()} ${body.error ?? ""}`);
  }
}

/** 0-based seat index on the clock for `pickNumber` in a snake of `TEAM_COUNT` seats. */
function snakeIndex(pickNumber: number): number {
  const round = Math.ceil(pickNumber / TEAM_COUNT);
  const offset = (pickNumber - 1) % TEAM_COUNT;
  return round % 2 === 1 ? offset : TEAM_COUNT - 1 - offset;
}
