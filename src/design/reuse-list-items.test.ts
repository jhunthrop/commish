import { describe, expect, it } from "vitest";
import { reuseListItems } from "./reuse-list-items";

interface Row {
  readonly id: string;
  readonly rank: number;
  readonly drafted: boolean;
}

const keyOf = (row: Row): string => row.id;
const row = (id: string, rank: number, drafted = false): Row => ({ id, rank, drafted });

describe("reuseListItems", () => {
  it("returns the previous array when every row is shallowly equal in the same order", () => {
    const previous = [row("a", 1), row("b", 2)];
    expect(reuseListItems(previous, [row("a", 1), row("b", 2)], keyOf)).toBe(previous);
  });

  it("keeps the previous object for unchanged rows and takes the new object only where a field moved", () => {
    const previous = [row("a", 1), row("b", 2), row("c", 3)];
    const next = [row("a", 1), row("b", 2, true), row("c", 3)];
    const reused = reuseListItems(previous, next, keyOf);
    expect(reused).not.toBe(previous);
    expect(reused[0]).toBe(previous[0]);
    expect(reused[1]).toBe(next[1]);
    expect(reused[2]).toBe(previous[2]);
  });

  it("a row that left produces a new array whose surviving rows keep their identity", () => {
    const previous = [row("a", 1), row("b", 2), row("c", 3)];
    const reused = reuseListItems(previous, [row("a", 1), row("c", 3)], keyOf);
    expect(reused).toHaveLength(2);
    expect(reused[0]).toBe(previous[0]);
    expect(reused[1]).toBe(previous[2]);
  });

  it("a reorder with equal rows keeps every object but not the array", () => {
    const previous = [row("a", 1), row("b", 2)];
    const reused = reuseListItems(previous, [row("b", 2), row("a", 1)], keyOf);
    expect(reused).not.toBe(previous);
    expect(reused[0]).toBe(previous[1]);
    expect(reused[1]).toBe(previous[0]);
  });

  it("with no previous list the next list is taken as it is", () => {
    const next = [row("a", 1)];
    expect(reuseListItems(null, next, keyOf)).toBe(next);
  });
});
