import { describe, expect, it } from "vitest";
import { CLOSED_DRAWER, drawerReduce, type DrawerState } from "./drawer-state";

const at = (surface: DrawerState["surface"], height: DrawerState["height"]): DrawerState => ({
  surface,
  height,
  lastSurface: surface ?? "players",
});

describe("drawerReduce", () => {
  describe("chipTap", () => {
    it("opens a closed drawer to half on the tapped surface", () => {
      expect(drawerReduce(CLOSED_DRAWER, { kind: "chipTap", surface: "standings" })).toEqual(
        at("standings", "half"),
      );
    });

    it("collapses when tapping the already-open surface at half", () => {
      expect(drawerReduce(at("standings", "half"), { kind: "chipTap", surface: "standings" })).toEqual({
        surface: null,
        height: "chip",
        lastSurface: "standings",
      });
    });

    it("collapses when tapping the already-open surface at full", () => {
      expect(drawerReduce(at("players", "full"), { kind: "chipTap", surface: "players" }).height).toBe("chip");
    });

    it("switches surface keeping the height (one expanded surface at a time)", () => {
      expect(drawerReduce(at("players", "full"), { kind: "chipTap", surface: "trades" })).toEqual(
        at("trades", "full"),
      );
    });
  });

  describe("expand", () => {
    it("takes half to full", () => {
      expect(drawerReduce(at("activity", "half"), { kind: "expand" })).toEqual(at("activity", "full"));
    });

    it("does nothing while closed", () => {
      expect(drawerReduce(CLOSED_DRAWER, { kind: "expand" })).toEqual(CLOSED_DRAWER);
    });
  });

  describe("space", () => {
    it("reopens the last-used surface at half from closed", () => {
      const closedAfterTrades: DrawerState = { surface: null, height: "chip", lastSurface: "trades" };
      expect(drawerReduce(closedAfterTrades, { kind: "space" })).toEqual(at("trades", "half"));
    });

    it("defaults to players before any surface was used", () => {
      expect(drawerReduce(CLOSED_DRAWER, { kind: "space" })).toEqual(at("players", "half"));
    });

    it("collapses a half drawer", () => {
      expect(drawerReduce(at("players", "half"), { kind: "space" }).height).toBe("chip");
    });

    it("steps a full drawer down to half", () => {
      expect(drawerReduce(at("standings", "full"), { kind: "space" })).toEqual(at("standings", "half"));
    });
  });

  describe("slash", () => {
    it("opens players at half from closed", () => {
      expect(drawerReduce(CLOSED_DRAWER, { kind: "slash" })).toEqual(at("players", "half"));
    });

    it("switches a half drawer on another surface to players at half", () => {
      expect(drawerReduce(at("trades", "half"), { kind: "slash" })).toEqual(at("players", "half"));
    });

    it("keeps full height when switching to players from a full surface", () => {
      expect(drawerReduce(at("standings", "full"), { kind: "slash" })).toEqual(at("players", "full"));
    });

    it("is a no-op when players is already expanded", () => {
      const state = at("players", "full");
      expect(drawerReduce(state, { kind: "slash" })).toBe(state);
    });
  });

  describe("esc", () => {
    it("walks full down to half", () => {
      expect(drawerReduce(at("players", "full"), { kind: "esc" })).toEqual(at("players", "half"));
    });

    it("walks half down to the chip row", () => {
      expect(drawerReduce(at("players", "half"), { kind: "esc" }).height).toBe("chip");
    });

    it("does nothing when already closed", () => {
      expect(drawerReduce(CLOSED_DRAWER, { kind: "esc" })).toEqual(CLOSED_DRAWER);
    });
  });

  describe("routeSync", () => {
    it("lands a deep link at full on the routed surface", () => {
      expect(drawerReduce(CLOSED_DRAWER, { kind: "routeSync", surface: "activity" })).toEqual(
        at("activity", "full"),
      );
    });

    it("steps down to half when the URL returns to the room from a full drawer", () => {
      expect(drawerReduce(at("players", "full"), { kind: "routeSync", surface: null })).toEqual(
        at("players", "half"),
      );
    });

    it("leaves a half drawer alone on the room URL", () => {
      const state = at("standings", "half");
      expect(drawerReduce(state, { kind: "routeSync", surface: null })).toBe(state);
    });

    it("switches surface at full when the URL names a different surface", () => {
      expect(drawerReduce(at("players", "full"), { kind: "routeSync", surface: "trades" })).toEqual(
        at("trades", "full"),
      );
    });
  });

  it("never leaves a surface open at chip height", () => {
    const states: DrawerState[] = [CLOSED_DRAWER, at("players", "half"), at("trades", "full")];
    const events = [
      { kind: "chipTap", surface: "players" },
      { kind: "chipTap", surface: "standings" },
      { kind: "expand" },
      { kind: "space" },
      { kind: "slash" },
      { kind: "esc" },
      { kind: "routeSync", surface: null },
      { kind: "routeSync", surface: "activity" },
    ] as const;
    for (const state of states) {
      for (const event of events) {
        const next = drawerReduce(state, event);
        expect(next.surface === null).toBe(next.height === "chip");
      }
    }
  });
});
