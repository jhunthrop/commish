import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useMediaQuery } from "./use-media-query";

describe("useMediaQuery", () => {
  it("answers from matchMedia on the client: a query the test viewport meets is true, one it cannot meet is false", () => {
    expect(renderHook(() => useMediaQuery("(min-width: 64rem)")).result.current).toBe(true);
    expect(renderHook(() => useMediaQuery("(min-width: 5000px)")).result.current).toBe(false);
  });

  it("answers false on the server render, so the hydrating client's first render agrees byte-for-byte", () => {
    function Probe() {
      return <span>{String(useMediaQuery("(min-width: 64rem)"))}</span>;
    }
    expect(renderToString(<Probe />)).toContain("false");
  });
});
