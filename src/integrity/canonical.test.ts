import { describe, expect, it } from "vitest";
import { canonicalSerialize } from "./canonical";

describe("canonicalSerialize", () => {
  it("sorts object keys, so two objects that differ only in key order are the same bytes", () => {
    // THE reason this function exists. `jsonb` does not preserve key order, so a payload
    // hashed as written and re-hashed as read back would otherwise never match.
    expect(canonicalSerialize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalSerialize({ a: 2, b: 1 })).toBe(canonicalSerialize({ b: 1, a: 2 }));
    expect(canonicalSerialize({ outer: { z: [1, { y: true, x: null }], a: "s" } })).toBe(
      '{"outer":{"a":"s","z":[1,{"x":null,"y":true}]}}',
    );
  });

  it("preserves array order, because an array is ordered data and an object is not", () => {
    expect(canonicalSerialize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("serializes both booleans", () => {
    expect(canonicalSerialize(true)).toBe("true");
    expect(canonicalSerialize(false)).toBe("false");
  });

  it("emits no whitespace and no trailing separators", () => {
    expect(canonicalSerialize({ a: [], b: {} })).toBe('{"a":[],"b":{}}');
  });

  it("escapes strings the one way JSON does", () => {
    expect(canonicalSerialize('a"b\\c\nd')).toBe('"a\\"b\\\\c\\nd"');
    expect(canonicalSerialize("héllo 🏈")).toBe('"héllo 🏈"');
  });

  it("refuses every value a hash cannot survive a Postgres round trip with", () => {
    // Each one is named rather than covered by a type guard the reader has to trust, and each
    // message says which path failed so a caller can fix the payload rather than guess.
    const cases: readonly [unknown, string][] = [
      [undefined, "undefined"],
      [Number.NaN, "NaN"],
      [Number.POSITIVE_INFINITY, "Infinity"],
      [9007199254740993, "an unsafe integer"],       // > 2^53, loses precision on read-back
      [BigInt(10), "a bigint"],
      [new Date("2026-08-20T00:00:00.000Z"), "a Date"],
      [new Map(), "a Map"],
      [new Set(), "a Set"],
      [() => 1, "a function"],
      [Symbol("s"), "a symbol"],
      // Not `Object.prototype` (the encoder's only accepted object shape) and not a Date/Map/Set
      // either — the describe() fallback that names anything else "not canonical JSON".
      [Object.create(null), "not canonical JSON"],       // no prototype at all
      [new (class Foo {})(), "not canonical JSON"],      // a class instance, not a plain object
      [new Uint8Array([1, 2, 3]), "not canonical JSON"], // a typed array, not Array.isArray
      ["null byte: \u0000", "a NUL character"],       // Postgres cannot store it in jsonb or text
    ];
    for (const [value, fragment] of cases) {
      expect(() => canonicalSerialize({ field: value } as never)).toThrow(new RegExp(fragment));
    }
  });

  it("names the path of the offending value, however deep", () => {
    expect(() => canonicalSerialize({ a: { b: [0, { c: Number.NaN }] } } as never)).toThrow(/a\.b\[1\]\.c/);
  });

  it("names the value itself when it is the offender at the top level, not a field of it", () => {
    expect(() => canonicalSerialize(undefined as never)).toThrow(/^Audit payload cannot be hashed: the value is undefined\.$/);
  });

  it("refuses a cycle rather than overflowing the stack", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalSerialize(cyclic as never)).toThrow(/cycle/);
  });
});
