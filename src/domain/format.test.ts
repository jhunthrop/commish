import { describe, expect, it } from "vitest";
import { formatOrdinal } from "./format";

describe("formatOrdinal", () => {
  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [9, "9th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [22, "22nd"],
    [23, "23rd"],
    [101, "101st"],
    [111, "111th"],
  ])("renders %i as %s", (n, expected) => {
    expect(formatOrdinal(n)).toBe(expected);
  });
});
