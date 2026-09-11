import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useChangeKey } from "./use-change-key";

describe("useChangeKey", () => {
  it("is 0 on mount, steps once per change, and holds through re-renders with the same value", () => {
    const { result, rerender } = renderHook(({ value }) => useChangeKey(value), { initialProps: { value: "46%" } });
    expect(result.current).toBe(0);
    rerender({ value: "46%" });
    expect(result.current).toBe(0);
    rerender({ value: "51%" });
    expect(result.current).toBe(1);
    rerender({ value: "51%" });
    expect(result.current).toBe(1);
    rerender({ value: "38%" });
    expect(result.current).toBe(2);
  });

  it("treats null as a value of its own, so a figure appearing or vanishing counts as a change", () => {
    const { result, rerender } = renderHook(({ value }) => useChangeKey<number | null>(value), { initialProps: { value: null as number | null } });
    expect(result.current).toBe(0);
    rerender({ value: 12 });
    expect(result.current).toBe(1);
    rerender({ value: null });
    expect(result.current).toBe(2);
  });
});
