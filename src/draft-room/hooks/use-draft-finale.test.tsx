import { useEffect } from "react";
import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import { useDraftFinale, type DraftFinaleArgs } from "./use-draft-finale";

const { momentMs, resultsRetryMs, resultsRetryCount } = DRAFT_ROOM_CONFIG.finale;

function args(overrides: Partial<DraftFinaleArgs> = {}): DraftFinaleArgs {
  return { phase: "in_progress", isMock: false, hasResults: false, refresh: vi.fn(async () => {}), ...overrides };
}

function mounted(initial: DraftFinaleArgs) {
  return renderHook((props: DraftFinaleArgs) => useDraftFinale(props), { initialProps: initial });
}

/** Advances fake timers AND flushes the microtasks a settling `refresh()` queues behind them. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useDraftFinale", () => {
  it("fires the moment exactly once, on the in_progress → complete transition", async () => {
    const initial = args();
    const { result, rerender } = mounted(initial);
    expect(result.current.stage).toBe("idle");

    rerender({ ...initial, phase: "complete" });
    expect(result.current.stage).toBe("moment");

    // Re-rendering in the complete state never re-fires: the beat hands off to the panel and
    // later complete-phase renders leave it there.
    await advance(momentMs);
    expect(result.current.stage).toBe("panel");
    rerender({ ...initial, phase: "complete" });
    expect(result.current.stage).toBe("panel");
  });

  // Fix round 1, HIGH 1: one combined refetch can deliver the phase flip AND `mock.results`
  // in a single state update (the onOpen resync). The detector runs during render, so no
  // COMMITTED frame may ever pair results with an idle stage — that frame is the parent
  // mounting the debrief for a flash before the beat. The probe logs each committed frame
  // (effects run per commit, never for a render React discarded).
  it("detects the flip during render — a combined update never commits a frame with results and an idle stage", () => {
    const commits: string[] = [];
    function Probe(props: DraftFinaleArgs) {
      const { stage } = useDraftFinale(props);
      useEffect(() => {
        commits.push(`${stage}|${props.hasResults ? "results" : "none"}`);
      });
      return null;
    }
    const initial = args({ isMock: true });
    const { rerender } = render(<Probe {...initial} />);
    rerender(<Probe {...initial} phase="complete" hasResults={true} />);
    expect(commits).not.toContain("idle|results");
    expect(commits[commits.length - 1]).toBe("moment|results");
  });

  it("never fires for a draft that was already complete at load", async () => {
    // The loading render (phase null) settling straight into complete is exactly the fresh
    // page load of a finished draft — the guard the debrief path depends on.
    const initial = args({ phase: null, isMock: true });
    const { result, rerender } = mounted(initial);
    rerender({ ...initial, phase: "complete" });
    await advance(momentMs * 2);
    expect(result.current.stage).toBe("idle");
    expect(initial.refresh).not.toHaveBeenCalled();
  });

  it("holds the beat for momentMs, then hands a real league to the panel and a dismiss returns to the board", async () => {
    const initial = args();
    const { result, rerender } = mounted(initial);
    rerender({ ...initial, phase: "complete" });

    await advance(momentMs - 1);
    expect(result.current.stage).toBe("moment");
    await advance(1);
    expect(result.current.stage).toBe("panel");

    act(() => result.current.dismiss());
    expect(result.current.stage).toBe("dismissed");
  });

  /** Walks the retry clock one spacing at a time, long past exhaustion, collecting the stages
   *  it passes through — timer/effect interleaving under fake timers makes exact per-advance
   *  call counts brittle, but the machine's INVARIANTS (which stages it visits, where it stops,
   *  how many fetches it ever makes) are exact. */
  async function walkCycles(read: () => string): Promise<Set<string>> {
    const seen = new Set<string>();
    for (let step = 0; step < (resultsRetryCount + 2) * 4; step++) {
      await advance(resultsRetryMs);
      seen.add(read());
    }
    return seen;
  }

  it("hands a mock to the refetch cycle after the beat and stops the moment results arrive", async () => {
    const refresh = vi.fn(async () => {});
    const initial = args({ isMock: true, refresh });
    const { result, rerender } = mounted(initial);
    rerender({ ...initial, phase: "complete" });

    await advance(momentMs);
    expect(result.current.stage).toBe("refetching");
    // The first attempt fires immediately.
    await advance(0);
    expect(refresh).toHaveBeenCalledTimes(1);

    // The refetch landed results: the cycle stops driving, however long the clock runs on.
    rerender({ ...initial, phase: "complete", hasResults: true });
    await walkCycles(() => result.current.stage);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("exhausts one quiet cycle into the preparing line, one more into the manual fallback — never a loop", async () => {
    const refresh = vi.fn(async () => {});
    const initial = args({ isMock: true, refresh });
    const { result, rerender } = mounted(initial);
    rerender({ ...initial, phase: "complete" });
    await advance(momentMs);

    const seen = await walkCycles(() => result.current.stage);
    // It passed through the visible line, ended on the manual fallback, and made exactly two
    // cycles' worth of attempts — then nothing more, however long the walk ran.
    expect(seen.has("preparing")).toBe(true);
    expect(result.current.stage).toBe("manual");
    expect(refresh).toHaveBeenCalledTimes(resultsRetryCount * 2);
  });

  it("the manual button re-enters the bounded machine and ends back at manual, never a loop", async () => {
    const refresh = vi.fn(async () => {});
    const initial = args({ isMock: true, refresh });
    const { result, rerender } = mounted(initial);
    rerender({ ...initial, phase: "complete" });
    await advance(momentMs);
    await walkCycles(() => result.current.stage);
    expect(result.current.stage).toBe("manual");

    act(() => result.current.seeDebrief());
    expect(result.current.stage).toBe("refetching");
    await walkCycles(() => result.current.stage);
    expect(result.current.stage).toBe("manual");
    expect(refresh).toHaveBeenCalledTimes(resultsRetryCount * 4);
  });
});
