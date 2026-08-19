import { describe, it, expect } from "vitest";
import { isLineupLocked, weekStatusFromGames } from "./week-status";
import type { GameStatus } from "@/stats/provider";

const game = (status: GameStatus): { readonly status: GameStatus } => ({ status });

describe("weekStatusFromGames", () => {
  it("reads a week with zero games as scheduled — nothing has been listed yet", () => {
    expect(weekStatusFromGames([])).toBe("scheduled");
  });

  it("reads all-scheduled games as scheduled", () => {
    expect(weekStatusFromGames([game("scheduled"), game("scheduled"), game("scheduled")])).toBe("scheduled");
  });

  it("reads all-final games as final", () => {
    expect(weekStatusFromGames([game("final"), game("final"), game("final")])).toBe("final");
  });

  it("reads a mix of scheduled, in-progress and final as in_progress", () => {
    expect(weekStatusFromGames([game("final"), game("scheduled"), game("in_progress")])).toBe("in_progress");
  });

  it("reads a mix of only scheduled and only final (no game itself in_progress) as in_progress", () => {
    // The long tail of a Sunday night: fifteen games done, one not yet started.
    expect(weekStatusFromGames([game("final"), game("scheduled")])).toBe("in_progress");
  });

  it("reads a single scheduled game as scheduled", () => {
    expect(weekStatusFromGames([game("scheduled")])).toBe("scheduled");
  });

  it("reads a single in-progress game as in_progress", () => {
    expect(weekStatusFromGames([game("in_progress")])).toBe("in_progress");
  });

  it("reads a single final game as final", () => {
    expect(weekStatusFromGames([game("final")])).toBe("final");
  });
});

describe("isLineupLocked", () => {
  it("is unlocked for a null status — no stat_weeks row at all", () => {
    expect(isLineupLocked(null)).toBe(false);
  });

  it("is unlocked while the week is scheduled", () => {
    expect(isLineupLocked("scheduled")).toBe(false);
  });

  it("is locked once the week is in progress", () => {
    expect(isLineupLocked("in_progress")).toBe(true);
  });

  it("is locked once the week is final", () => {
    expect(isLineupLocked("final")).toBe(true);
  });
});
