import { describe, it, expect } from "vitest";
import { createRateLimiter } from "./rate-limit";

function fakeClock(start = 1_000) {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

describe("createRateLimiter", () => {
  it("allows exactly the configured number of requests in a window, then refuses", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ maxRequests: 3, windowMs: 1_000, now: clock.now });
    expect([limiter.allow("u1"), limiter.allow("u1"), limiter.allow("u1")]).toEqual([true, true, true]);
    expect(limiter.allow("u1")).toBe(false);
  });

  it("keeps one key's spending off another's budget", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 1_000, now: clock.now });
    expect(limiter.allow("u1")).toBe(true);
    expect(limiter.allow("u1")).toBe(false);
    expect(limiter.allow("u2")).toBe(true);
  });

  it("hands the budget back once the window has passed", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 1_000, now: clock.now });
    expect(limiter.allow("u1")).toBe(true);
    expect(limiter.allow("u1")).toBe(false);
    clock.advance(1_000);
    expect(limiter.allow("u1")).toBe(true);
  });

  it("forgets keys whose window has lapsed rather than growing a map per user seen", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 1_000, now: clock.now });
    limiter.allow("u1");
    limiter.allow("u2");
    limiter.allow("u3");
    expect(limiter.tracked()).toBe(3);
    clock.advance(1_001);
    // The sweep runs when a key is first seen — the moment the map would otherwise grow.
    limiter.allow("u4");
    expect(limiter.tracked()).toBe(1);
  });

  it("drops every window on reset", () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 1_000 });
    expect(limiter.allow("u1")).toBe(true);
    expect(limiter.allow("u1")).toBe(false);
    limiter.reset();
    expect(limiter.tracked()).toBe(0);
    expect(limiter.allow("u1")).toBe(true);
  });

  it("defaults to the wall clock", () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    expect(limiter.allow("u1")).toBe(true);
    expect(limiter.allow("u1")).toBe(false);
  });
});
