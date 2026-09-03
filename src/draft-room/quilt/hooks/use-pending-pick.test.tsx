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

  it("submits immediately under the squeeze rule", () => {
    const submit = vi.fn();
    const soon = new Date(Date.now() + 1_000).toISOString();
    const { result } = renderHook(() => usePendingPick(submit, soon));
    act(() => result.current.begin("p1"));
    expect(submit).toHaveBeenCalledWith("p1");
    expect(result.current.pending).toBeNull();
  });

  it("a second begin replaces the first — only the last pick submits", () => {
    const submit = vi.fn();
    const { result } = renderHook(() => usePendingPick(submit, farDeadline()));
    act(() => result.current.begin("p1"));
    act(() => vi.advanceTimersByTime(1_000));
    act(() => result.current.begin("p2"));
    act(() => vi.advanceTimersByTime(QUILT_CONFIG.undoWindowMs));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("p2");
  });

  it("unmount abandons the window without submitting", () => {
    const submit = vi.fn();
    const { result, unmount } = renderHook(() => usePendingPick(submit, farDeadline()));
    act(() => result.current.begin("p1"));
    unmount();
    act(() => vi.advanceTimersByTime(QUILT_CONFIG.undoWindowMs * 2));
    expect(submit).not.toHaveBeenCalled();
  });
});
