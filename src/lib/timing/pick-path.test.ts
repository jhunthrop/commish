import { describe, expect, it } from "vitest";
import { createPickPathTimer, parsePickPathLine, PICK_PATH_PREFIX, pickPath } from "./pick-path";

function fakeTimer(enabled: boolean) {
  const lines: string[] = [];
  let tick = 100;
  const timer = createPickPathTimer({ enabled, sink: (line) => lines.push(line), now: () => (tick += 12.34), wallClock: () => "2026-09-19T00:00:00.000Z" });
  return { timer, lines };
}

describe("the pick-path timer", () => {
  it("disabled: runs the work, logs nothing, marks nothing", async () => {
    const { timer, lines } = fakeTimer(false);
    expect(timer.enabled).toBe(false);
    await expect(timer.time("advance", async () => 7)).resolves.toBe(7);
    timer.mark("late");
    expect(lines).toEqual([]);
  });

  it("enabled: one prefixed JSON line per stage, with the label, the start instant, the wall ms and the caller's fields", async () => {
    const { timer, lines } = fakeTimer(true);
    await timer.time("advance", async () => "done", { draftId: "d1", applied: 1 });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.startsWith(PICK_PATH_PREFIX)).toBe(true);
    expect(parsePickPathLine(lines[0]!)).toEqual({ label: "advance", at: "2026-09-19T00:00:00.000Z", ms: 12.3, draftId: "d1", applied: 1 });
  });

  it("fields may be derived from the result, and the label always wins over a field of the same name", async () => {
    const { timer, lines } = fakeTimer(true);
    await timer.time("publish", async () => ({ id: "1-0" }), (result) => ({ streamId: result.id, label: "spoofed" }));
    expect(parsePickPathLine(lines[0]!)).toMatchObject({ label: "publish", streamId: "1-0" });
  });

  it("a stage that throws logs nothing and rethrows", async () => {
    const { timer, lines } = fakeTimer(true);
    await expect(timer.time("advance", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(lines).toEqual([]);
  });

  it("mark writes an instant with zero ms", () => {
    const { timer, lines } = fakeTimer(true);
    timer.mark("loop.late", { lateMs: 40 });
    expect(parsePickPathLine(lines[0]!)).toEqual({ label: "loop.late", at: "2026-09-19T00:00:00.000Z", ms: 0, lateMs: 40 });
  });

  it("parsePickPathLine refuses prose, other prefixes and malformed JSON", () => {
    expect(parsePickPathLine("[draft] advance wedged {}")).toBeNull();
    expect(parsePickPathLine(`${PICK_PATH_PREFIX}{not json`)).toBeNull();
    expect(parsePickPathLine(`${PICK_PATH_PREFIX}{"label":"x"}`)).toBeNull();
    expect(parsePickPathLine(`${PICK_PATH_PREFIX}[1]`)).toBeNull();
  });

  it("the process-wide timer is off unless DRAFT_PICK_PATH_TIMING=1 was set at load", () => {
    expect(pickPath.enabled).toBe(process.env.DRAFT_PICK_PATH_TIMING === "1");
  });
});
