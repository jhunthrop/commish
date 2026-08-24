import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./return-to";

describe("safeReturnTo", () => {
  it("accepts a same-origin path and hands it back unchanged", () => {
    expect(safeReturnTo("/join/lg_bandits/hold")).toBe("/join/lg_bandits/hold");
    expect(safeReturnTo("/app/leagues/lg_bandits?week=3")).toBe("/app/leagues/lg_bandits?week=3");
  });

  it("refuses every shape that could send somebody somewhere else", () => {
    // The SDK's callback only ever applies `.pathname` and `.search` to OUR request url, so none of
    // these could actually leave our origin today. We refuse them anyway: a validator that relies
    // on a dependency's internals is a validator that breaks silently the day that dependency is
    // upgraded, and this is the one function in the product whose job is to be paranoid.
    for (const hostile of ["//evil.example", "https://evil.example/x", "http:/evil", "/\\evil.example", "javascript:alert(1)", "", " ", null]) {
      expect(safeReturnTo(hostile)).toBeNull();
    }
  });

  it("refuses a path back to the auth routes themselves, because a loop is not a destination", () => {
    for (const loop of ["/sign-in", "/sign-up", "/callback", "/sign-out", "/sign-in/problem"]) {
      expect(safeReturnTo(loop)).toBeNull();
    }
  });

  // Not in the brief's own list, but the exact vector `RESOLUTION_ORIGIN`'s docblock names: a
  // browser (and `URL`) strips tab/newline/carriage-return characters before further parsing, so
  // a naive `raw.startsWith("/")` check alone would wave this through as though it were a plain
  // path. `safeReturnTo` must catch it too, or its own paranoia claim would be false.
  it("refuses a control-character trick that only becomes protocol-relative after URL parsing strips it", () => {
    expect(safeReturnTo("/\t/evil.example")).toBeNull();
    expect(safeReturnTo("/\n/evil.example")).toBeNull();
    expect(safeReturnTo("/\r/evil.example")).toBeNull();
  });

  it("leaves a path that merely starts with an auth route's name alone", () => {
    // Exact-pathname refusal, not a prefix ban — a hypothetical `/sign-in-help` page must not be
    // caught by the `/sign-in` refusal.
    expect(safeReturnTo("/sign-in-help")).toBe("/sign-in-help");
  });
});
