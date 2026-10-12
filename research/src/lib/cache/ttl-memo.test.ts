import { describe, expect, it, vi } from "vitest";
import { createTtlMemo, invalidateAllTtlMemosForTests, invalidateTtlMemoGroup } from "./ttl-memo";

const T0 = Date.parse("2026-09-08T12:00:00.000Z");

function clockAt(offset: { ms: number }) {
  return { now: () => new Date(T0 + offset.ms).toISOString() };
}

describe("createTtlMemo", () => {
  it("loads once per key inside the TTL and reloads after it", async () => {
    const offset = { ms: 0 };
    const memo = createTtlMemo<number>(1_000, clockAt(offset));
    const load = vi.fn(async () => 42);

    expect(await memo.get("a", load)).toBe(42);
    offset.ms = 999;
    expect(await memo.get("a", load)).toBe(42);
    expect(load).toHaveBeenCalledTimes(1);

    offset.ms = 1_000;
    expect(await memo.get("a", load)).toBe(42);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keys independently", async () => {
    const memo = createTtlMemo<string>(1_000, clockAt({ ms: 0 }));
    expect(await memo.get("a", async () => "A")).toBe("A");
    expect(await memo.get("b", async () => "B")).toBe("B");
    expect(await memo.get("a", async () => "never")).toBe("A");
  });

  it("shares an in-flight load between concurrent misses", async () => {
    const memo = createTtlMemo<number>(1_000, clockAt({ ms: 0 }));
    let resolve: ((n: number) => void) | null = null;
    const load = vi.fn(() => new Promise<number>((r) => (resolve = r)));
    const first = memo.get("a", load);
    const second = memo.get("a", load);
    resolve!(7);
    expect(await Promise.all([first, second])).toEqual([7, 7]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed load: the next call retries", async () => {
    const memo = createTtlMemo<number>(1_000, clockAt({ ms: 0 }));
    await expect(memo.get("a", async () => Promise.reject(new Error("down")))).rejects.toThrow("down");
    expect(await memo.get("a", async () => 1)).toBe(1);
  });

  it("invalidates one key or all", async () => {
    const memo = createTtlMemo<number>(1_000, clockAt({ ms: 0 }));
    await memo.get("a", async () => 1);
    await memo.get("b", async () => 2);
    memo.invalidate("a");
    expect(await memo.get("a", async () => 10)).toBe(10);
    expect(await memo.get("b", async () => 20)).toBe(2);
    memo.invalidate();
    expect(await memo.get("b", async () => 30)).toBe(30);
  });

  it("clears every memo of a named group on a write, and no memo outside it", async () => {
    const inGroup = createTtlMemo<number>(1_000, clockAt({ ms: 0 }), { group: "board" });
    const alsoInGroup = createTtlMemo<number>(1_000, clockAt({ ms: 0 }), { group: "board" });
    const outside = createTtlMemo<number>(1_000, clockAt({ ms: 0 }));
    await inGroup.get("k", async () => 1);
    await alsoInGroup.get("k", async () => 2);
    await outside.get("k", async () => 3);
    expect(invalidateTtlMemoGroup("board")).toBeGreaterThanOrEqual(2);
    expect(await inGroup.get("k", async () => 10)).toBe(10);
    expect(await alsoInGroup.get("k", async () => 20)).toBe(20);
    expect(await outside.get("k", async () => 30)).toBe(3);
    expect(invalidateTtlMemoGroup("nobody-named-this")).toBe(0);
  });

  it("the test-only reset empties every memo created in the process", async () => {
    const a = createTtlMemo<number>(1_000, clockAt({ ms: 0 }));
    const b = createTtlMemo<number>(1_000, clockAt({ ms: 0 }));
    await a.get("k", async () => 1);
    await b.get("k", async () => 2);
    invalidateAllTtlMemosForTests();
    expect(await a.get("k", async () => 10)).toBe(10);
    expect(await b.get("k", async () => 20)).toBe(20);
  });

  it("refuses a non-positive TTL", () => {
    expect(() => createTtlMemo(0)).toThrow(/positive/);
  });
});
