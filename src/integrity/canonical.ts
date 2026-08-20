import type { JsonValue } from "@/domain/audit";

/**
 * The bytes a hash is taken over: JSON with object keys sorted and no whitespace.
 *
 * Sorted keys are not a style choice. The verifier re-derives an event's hash from the row it
 * reads back out of Postgres, and `jsonb` does not preserve key order (it stores an object as a
 * sorted, deduplicated map). Hashing `JSON.stringify(payload)` would therefore produce one
 * digest on write and, for the same data, a different one on read.
 *
 * Everything this encoder refuses, it refuses because it would not survive that same round trip:
 * a `Date` becomes a string, `NaN`/`Infinity` become `null`, an integer past 2^53 loses digits,
 * and a NUL character cannot be stored in a Postgres `jsonb` or `text` value at all. Failing at
 * the write, with the path named, is the only version of this that a reader can act on.
 */
export function canonicalSerialize(value: JsonValue): string {
  return write(value, "", new Set());
}

function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return "a bigint";
  if (typeof value === "function") return "a function";
  if (typeof value === "symbol") return "a symbol";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (!Number.isFinite(value)) return "Infinity";
    return "an unsafe integer";
  }
  if (value instanceof Date) return "a Date";
  if (value instanceof Map) return "a Map";
  if (value instanceof Set) return "a Set";
  return "not canonical JSON";
}

function refuse(path: string, value: unknown): never {
  throw new Error(`Audit payload cannot be hashed: ${path === "" ? "the value" : path} is ${describe(value)}.`);
}

function write(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) refuse(path, value);
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) refuse(path, value);
    return String(value);
  }
  if (typeof value === "string") {
    if (value.includes("\u0000")) throw new Error(`Audit payload cannot be hashed: ${path} contains a NUL character.`);
    return JSON.stringify(value);
  }
  if (typeof value !== "object") refuse(path, value);
  const object = value as object;
  if (seen.has(object)) throw new Error(`Audit payload cannot be hashed: ${path} closes a cycle.`);
  const nested = new Set(seen).add(object);
  if (Array.isArray(object)) {
    return `[${object.map((item, index) => write(item, `${path}[${index}]`, nested)).join(",")}]`;
  }
  if (Object.getPrototypeOf(object) !== Object.prototype) refuse(path, object);
  const keys = Object.keys(object as Record<string, unknown>).sort();
  const entries = keys.map((key) => {
    const child = (object as Record<string, unknown>)[key];
    const childPath = path === "" ? key : `${path}.${key}`;
    if (child === undefined) refuse(childPath, child);
    return `${JSON.stringify(key)}:${write(child, childPath, nested)}`;
  });
  return `{${entries.join(",")}}`;
}
