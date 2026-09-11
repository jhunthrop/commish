import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUILT_CONFIG } from "../state/config";
import { usePendingPick } from "./use-pending-pick";

const farDeadline = (): string => new Date(Date.now() + 60_000).toISOString();

describe("usePendingPick", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("submits only when the window expires", () => {
    const submit = vi.fn();
    const { result } = renderHook(() => usePendingPick(submit, farDeadline()));
    act(() => result.current.begin("p1"));
    expect(result.current.pending?.playerId).toBe("p1");
    expect(submit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(QUILT_CONFIG.undoWindowMs));
    expect(submit).toHaveBeenCalledWith("p1");
    expect(result.current.pending).toBeNull();
  });

  it("undo cancels the window and nothing is ever sent", () => {
    const submit = vi.fn();
    const { result } = renderHook(() => usePendingPick(submit, farDeadline()));
    act(() => result.current.begin("p1"));
    act(() => result.current.undo());
    act(() => vi.advanceTimersByTime(QUILT_CONFIG.undoWindowMs * 2));
    expect(submit).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();
  });

  it("keeps begin's identity across a new deadline, and still reads the current one (fix round 1)", () => {
    const submit = vi.fn();
    const { result, rerender } = renderHook(({ deadline }) => usePendingPick(submit, deadline), { initialProps: { deadline: farDeadline() } });
    const first = result.current.begin;
    // The next turn's deadline is inside the squeeze: begin must submit at once, through the
    // same function object every row already holds.
    const soon = new Date(Date.now() + QUILT_CONFIG.undoWindowMs).toISOString();
    rerender({ deadline: soon });
    expect(result.current.begin).toBe(first);
    act(() => result.current.begin("rb1"));
    expect(submit).toHaveBeenCalledWith("rb1");
  });

  it("submits immediately under the squeeze rule", () => {
    const submit = vi.fn();
    const soon = new Date(Date.now() + 1_000).toISOString();
    const { result } = renderHook(() => usePendingPick(submit, soon));
    act(() => result.current.begin("p1"));
    expect(submit).toHaveBeenCalledWith("p1");
    expect(result.current.pending).toBeNull();
  });

  it("a second begin replaces the first — only the last pick submits, and the window says what it swapped", () => {
    const submit = vi.fn();
    const { result } = renderHook(() => usePendingPick(submit, farDeadline()));
    act(() => result.current.begin("p1"));
    act(() => vi.advanceTimersByTime(1_000));
    act(() => result.current.begin("p2"));
    expect(result.current.pending?.swappedFromPlayerId).toBe("p1");
    act(() => vi.advanceTimersByTime(QUILT_CONFIG.undoWindowMs));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("p2");
    // Re-tapping the SAME player is not a swap — there is nothing to announce.
    act(() => result.current.begin("p2"));
    act(() => result.current.begin("p2"));
    expect(result.current.pending?.swappedFromPlayerId).toBeNull();
  });

  it("unmount FLUSHES a held pick — a tapped DRAFT is never silently dropped", () => {
    const submit = vi.fn();
    const { result, unmount } = renderHook(() => usePendingPick(submit, farDeadline()));
    act(() => result.current.begin("p1"));
    unmount();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("p1");
    // The flush already submitted; the dead timer must not fire a second copy.
    act(() => vi.advanceTimersByTime(QUILT_CONFIG.undoWindowMs * 2));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("unmount after an undo submits nothing — the discard was said out loud", () => {
    const submit = vi.fn();
    const { result, unmount } = renderHook(() => usePendingPick(submit, farDeadline()));
    act(() => result.current.begin("p1"));
    act(() => result.current.undo());
    unmount();
    expect(submit).not.toHaveBeenCalled();
  });

  it("guards the tab while a pick pends: beforeunload registered, pagehide flushes, both released", () => {
    const submit = vi.fn();
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { result } = renderHook(() => usePendingPick(submit, farDeadline()));
    expect(addSpy).not.toHaveBeenCalledWith("beforeunload", expect.any(Function));
    act(() => result.current.begin("p1"));
    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith("pagehide", expect.any(Function));

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(submit).toHaveBeenCalledWith("p1");
    expect(result.current.pending).toBeNull();
    expect(removeSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("pagehide", expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
