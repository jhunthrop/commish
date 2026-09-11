import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MOTION, SETTLE_RISE_PX } from "./motion";
import { TOKENS } from "./tokens";

const GLOBALS_CSS = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

describe("MOTION (the room's named motions)", () => {
  it("no named motion is slower than an arrival (P4's band), and each rides a token duration and easing", () => {
    const durations = new Set<number>(Object.values(TOKENS.motion.duration));
    for (const [name, motion] of Object.entries(MOTION)) {
      expect(motion.durationMs, name).toBeLessThanOrEqual(TOKENS.motion.duration.in);
      expect(durations.has(motion.durationMs), `${name} rides a token duration`).toBe(true);
      expect(Object.values(TOKENS.motion.easing), `${name} rides a token easing`).toContain(motion.easing);
    }
  });

  it("a pick settles in 180 to 240 ms with a 2 to 4 px rise (the coordinator's ruling)", () => {
    expect(MOTION.settle.durationMs).toBeGreaterThanOrEqual(180);
    expect(MOTION.settle.durationMs).toBeLessThanOrEqual(240);
    expect(SETTLE_RISE_PX).toBeGreaterThanOrEqual(2);
    expect(SETTLE_RISE_PX).toBeLessThanOrEqual(4);
    expect(MOTION.settleStill.durationMs).toBe(MOTION.settle.durationMs);
    // The keyframes rise by the same figure the module states — one number, two places that agree.
    expect(GLOBALS_CSS).toMatch(new RegExp(`@keyframes commish-cell-settle\\s*\\{[^}]*translateY\\(${SETTLE_RISE_PX}px\\)`));
  });

  it("every class a named motion names exists in globals.css and reads a motion token, never a literal duration", () => {
    for (const [name, motion] of Object.entries(MOTION)) {
      const rule = new RegExp(`\\.${motion.className}\\s*\\{([^}]*)\\}`).exec(GLOBALS_CSS);
      expect(rule, `${name} -> .${motion.className} in globals.css`).not.toBeNull();
      const body = rule![1]!;
      expect(body).toMatch(/--commish-motion-duration-/);
      expect(body).not.toMatch(/\d+\s*ms/);
    }
  });

  it("a leaving row is gone faster than an entering one settles, so a list never holds ghosts longer than it welcomes newcomers", () => {
    expect(MOTION.leave.durationMs).toBeLessThanOrEqual(MOTION.enter.durationMs);
  });
});
