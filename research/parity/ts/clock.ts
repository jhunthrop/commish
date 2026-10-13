/**
 * THE WALL CLOCK, FROZEN AT THE PARITY INSTANT. Several production paths read `new Date()` where
 * no clock is injected (a publisher's fetched-at stamp, the week-one roster's default clock, the
 * odds snapshot's window), and the Python side is handed the same instant explicitly. Only the
 * no-argument forms are frozen; `new Date(x)` and `Date.UTC` behave exactly as before.
 */
export function freezeWallClock(nowMs: number): void {
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date> | []) {
      if (args.length === 0) super(nowMs);
      else super(...(args as ConstructorParameters<typeof Date>));
    }
    static override now(): number {
      return nowMs;
    }
  }
  globalThis.Date = FrozenDate as DateConstructor;
}
