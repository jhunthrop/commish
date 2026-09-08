import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { ADVISOR_ROOM_CONFIG } from "./config";
import { isPickCount, readPickCount, usePickCount, writePickCount } from "./pick-count";

const KEY = ADVISOR_ROOM_CONFIG.pickCount.storageKey;

describe("pick count", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("offers three counts, defaults to five, and only admits those three", () => {
    expect(ADVISOR_ROOM_CONFIG.pickCount.options).toEqual([3, 5, 10]);
    expect(ADVISOR_ROOM_CONFIG.pickCount.default).toBe(5);
    expect(isPickCount(3)).toBe(true);
    expect(isPickCount(10)).toBe(true);
    expect(isPickCount(7)).toBe(false);
  });

  it("reads the remembered count under the named key, falling back to the default on anything else", () => {
    expect(readPickCount()).toBe(5);
    window.localStorage.setItem(KEY, "10");
    expect(readPickCount()).toBe(10);
    window.localStorage.setItem(KEY, "7");
    expect(readPickCount()).toBe(5);
    window.localStorage.setItem(KEY, "not a number");
    expect(readPickCount()).toBe(5);
  });

  it("survives a browser that refuses storage, both ways", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(readPickCount()).toBe(5);
    expect(() => writePickCount(3)).not.toThrow();
  });

  it("the hook starts at the default, picks up the remembered count after mount, and remembers a change", async () => {
    window.localStorage.setItem(KEY, "3");
    const { result } = renderHook(() => usePickCount());
    await waitFor(() => expect(result.current[0]).toBe(3));
    act(() => result.current[1](10));
    expect(result.current[0]).toBe(10);
    expect(window.localStorage.getItem(KEY)).toBe("10");
  });
});
