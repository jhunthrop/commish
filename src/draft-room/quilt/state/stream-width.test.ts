import { afterEach, describe, expect, it } from "vitest";
import { QUILT_CONFIG } from "./config";
import { DEFAULT_STREAM_WIDTH, narrower, readStreamWidth, writeStreamWidth } from "./stream-width";

afterEach(() => {
  window.localStorage.clear();
});

describe("stream width memory", () => {
  it("defaults to the rail, remembers a choice, and refuses junk", () => {
    expect(readStreamWidth()).toBe(DEFAULT_STREAM_WIDTH);
    writeStreamWidth("open");
    expect(readStreamWidth()).toBe("open");
    window.localStorage.setItem(QUILT_CONFIG.streamWidthStorageKey, "sideways");
    expect(readStreamWidth()).toBe("rail");
  });

  it("collapses one step at a time", () => {
    expect(narrower("open")).toBe("rail");
    expect(narrower("rail")).toBe("hidden");
    expect(narrower("hidden")).toBe("hidden");
  });
});
