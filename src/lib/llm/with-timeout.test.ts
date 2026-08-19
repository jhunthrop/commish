import { describe, it, expect, vi } from "vitest";
import { withTimeout } from "./with-timeout";

describe("withTimeout", () => {
  it("resolves with the promise's value when it settles before the deadline", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 50)).resolves.toBe("ok");
  });

  it("rejects once the deadline passes, naming the default label", async () => {
    await expect(withTimeout(new Promise(() => {}), 5)).rejects.toThrow("operation timed out");
  });

  it("names the caller in the rejection when a label is given", async () => {
    await expect(withTimeout(new Promise(() => {}), 5, "advisor")).rejects.toThrow("advisor timed out");
  });

  it("clears its timer on the fast path so no handle is left dangling", async () => {
    vi.useFakeTimers();
    try {
      const clearSpy = vi.spyOn(global, "clearTimeout");
      await withTimeout(Promise.resolve("done"), 1_000);
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates the original rejection when the promise loses to nothing (rejects first)", async () => {
    await expect(withTimeout(Promise.reject(new Error("upstream failed")), 50)).rejects.toThrow("upstream failed");
  });
});
