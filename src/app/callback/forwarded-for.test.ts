import { describe, expect, it } from "vitest";
import { firstForwardedFor } from "./forwarded-for";

describe("firstForwardedFor", () => {
  it.each<[string | null, string | null]>([
    ["203.0.113.7", "203.0.113.7"], // a single address, passed through
    ["203.0.113.7, 10.0.0.1, 10.0.0.2", "203.0.113.7"], // multi-hop: the first entry wins
    ["  203.0.113.7  , 10.0.0.1", "203.0.113.7"], // whitespace around the first entry is trimmed
    ["", null], // an empty header is not an address
    [null, null], // a missing header is not an address
    [",,,", null], // malformed — commas with nothing between them — stores null, not garbage
    [" , 10.0.0.1", null], // the first hop itself is blank; a later real-looking entry does not rescue it
  ])("firstForwardedFor(%j) -> %j", (header, expected) => {
    expect(firstForwardedFor(header)).toBe(expected);
  });
});
