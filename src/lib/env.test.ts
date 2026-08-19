import { afterEach, describe, expect, it } from "vitest";
import { envOr, envOrUndefined } from "./env";

const KEY = "COMMISH_ENV_TEST_VAR";

afterEach(() => {
  delete process.env[KEY];
});

describe("envOr", () => {
  it("returns the value when one is set", () => {
    process.env[KEY] = "real";
    expect(envOr(KEY, "fallback")).toBe("real");
  });

  it("falls back when the variable is absent", () => {
    expect(envOr(KEY, "fallback")).toBe("fallback");
  });

  it("falls back when the variable is an EMPTY STRING, which `??` would not", () => {
    // `.env.example` ships several vars as intentionally-empty lines, and dotenv reads those
    // as `""`, not as an absent key. This is the whole reason this helper exists.
    process.env[KEY] = "";
    expect(envOr(KEY, "fallback")).toBe("fallback");
    expect(process.env[KEY] ?? "fallback").toBe("");
  });
});

describe("envOrUndefined", () => {
  it("returns the value when one is set", () => {
    process.env[KEY] = "real";
    expect(envOrUndefined(KEY)).toBe("real");
  });

  it("returns undefined when absent", () => {
    expect(envOrUndefined(KEY)).toBeUndefined();
  });

  it("returns undefined for an empty string", () => {
    process.env[KEY] = "";
    expect(envOrUndefined(KEY)).toBeUndefined();
  });
});
