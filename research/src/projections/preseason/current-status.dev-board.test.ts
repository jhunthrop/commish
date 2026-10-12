import { describe, expect, it } from "vitest";
import { createDb } from "@research/db/client";
import { FITTED_MODEL } from "../model/source";
import { shippedPreseasonBoardInputs } from "../market/blend";
import { availabilityStatusFor, cutdownStatusOf } from "./availability-status";
import { withCurrentStatus } from "./current-status";
import { FITTED_AVAILABILITY_PRIORS, FITTED_CAREER_PRIORS, FITTED_DEPTH_PRIORS, FITTED_ROOKIE_PRIORS } from "./fitted";
import { isCappedRosterStatus, isExcludedRosterStatus } from "./roster-status";
import { liveMomentFor, loadPreseason, replayMomentFor, type BoardMoment, type PreseasonPriors } from "./source";

/**
 * THE AGREEMENT TEST OVER THE DEV BOARD (current-status round, 2026-09-09): for every player on the
 * 2026 board as the shipped build makes it, the gate's status and the availability model's status
 * input are the same word. Runs ONLY when `DEV_BOARD_DATABASE_URL` names the dev store (a
 * localhost URL is required; it refuses anything else), because it reads the whole real board
 * rather than a fixture: `DEV_BOARD_DATABASE_URL=postgres://... npx vitest run
 * src/projections/preseason/current-status.dev-board.test.ts`. Without the variable the suite is
 * skipped, so the lane suites never see it.
 */
const DEV_BOARD_DATABASE_URL = process.env.DEV_BOARD_DATABASE_URL;
const SEASON = 2026;
const JACOBS = "00-0035700";
const PRIORS: PreseasonPriors = { model: FITTED_MODEL, availability: FITTED_AVAILABILITY_PRIORS, rookies: FITTED_ROOKIE_PRIORS, depth: FITTED_DEPTH_PRIORS, career: FITTED_CAREER_PRIORS };

/** The live moment while the season has not kicked off, the replay moment once it has. */
async function boardMomentFor(db: ReturnType<typeof createDb>): Promise<BoardMoment> {
  try {
    return await liveMomentFor(db, SEASON, { now: () => new Date().toISOString() });
  } catch {
    return replayMomentFor(db, SEASON);
  }
}

describe.runIf(DEV_BOARD_DATABASE_URL !== undefined)("the gate and the availability model agree on every player of the dev board", () => {
  it("reads one status per player: capped kinds are reserve cases, active kinds are active, excluded kinds are off the board, unknown men keep the file", async () => {
    if (DEV_BOARD_DATABASE_URL === undefined || !/localhost|127\.0\.0\.1/.test(DEV_BOARD_DATABASE_URL)) {
      throw new Error("DEV_BOARD_DATABASE_URL must name the local dev store; this test never reads production.");
    }
    const db = createDb(DEV_BOARD_DATABASE_URL);
    try {
      const inputs = await loadPreseason(db, SEASON, { boardMoment: await boardMomentFor(db) });
      const { candidates, exclusions } = await shippedPreseasonBoardInputs(db, inputs, PRIORS, { raw: true });
      const { inputs: statused } = await withCurrentStatus(db, inputs);
      const fileStatus = new Map(inputs.roster.map((row) => [row.playerId, row.status] as const));
      expect(candidates.length).toBeGreaterThan(400);

      for (const candidate of candidates) {
        const current = statused.currentStatus.get(candidate.playerId);
        const input = availabilityStatusFor(current, fileStatus.get(candidate.playerId)!);
        const capped = candidate.reasons.some((reason) => reason.code === "roster_status");
        if (current === undefined) {
          expect(input).toBe(fileStatus.get(candidate.playerId));
          expect(capped).toBe(false);
          continue;
        }
        expect(isExcludedRosterStatus(current.kind)).toBe(false);
        expect(input).toBe(cutdownStatusOf(current.kind));
        expect(capped).toBe(isCappedRosterStatus(current.kind));
        expect(input === "reserve").toBe(isCappedRosterStatus(current.kind));
      }
      for (const excluded of exclusions) expect(isExcludedRosterStatus(statused.currentStatus.get(excluded.playerId)?.kind ?? "active")).toBe(true);

      // Jacobs, the finding: the sweep has him on Green Bay's active roster, designated Out.
      const jacobs = statused.currentStatus.get(JACOBS);
      if (jacobs !== undefined) {
        expect(jacobs.kind).toBe("active");
        expect(availabilityStatusFor(jacobs, fileStatus.get(JACOBS) ?? "active")).toBe("active");
      }
    } finally {
      await db.$client.end();
    }
  }, 120_000);
});
