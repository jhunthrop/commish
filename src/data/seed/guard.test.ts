import { describe, it, expect } from "vitest";
import { assertLocalSeedTarget, SEED_OPT_IN_ENV_VAR, type SeedEnv } from "./guard";

const LOCAL = "postgres://commish:commish@localhost:5432/commish";

function env(overrides: SeedEnv = {}): SeedEnv {
  return { [SEED_OPT_IN_ENV_VAR]: "1", DATABASE_URL: LOCAL, ...overrides };
}

describe("assertLocalSeedTarget", () => {
  it("allows an opted-in, loopback target", () => {
    expect(() => assertLocalSeedTarget(env())).not.toThrow();
    expect(() => assertLocalSeedTarget(env({ DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db" }))).not.toThrow();
  });

  it("fails closed when the opt-in is missing — the case `npm run seed` actually hits under tsx", () => {
    // `NODE_ENV` is undefined here, exactly as it is under `dotenv -e .env.local -- tsx …`.
    expect(() => assertLocalSeedTarget({ DATABASE_URL: LOCAL })).toThrow(/ALLOW_DESTRUCTIVE_SEED=1/);
    expect(() => assertLocalSeedTarget(env({ [SEED_OPT_IN_ENV_VAR]: "true" }))).toThrow(/ALLOW_DESTRUCTIVE_SEED=1/);
  });

  it("refuses when DATABASE_URL is absent or empty", () => {
    expect(() => assertLocalSeedTarget(env({ DATABASE_URL: undefined }))).toThrow(/DATABASE_URL is not set/);
    expect(() => assertLocalSeedTarget(env({ DATABASE_URL: "" }))).toThrow(/DATABASE_URL is not set/);
  });

  it("refuses a DATABASE_URL it cannot parse", () => {
    expect(() => assertLocalSeedTarget(env({ DATABASE_URL: "not a url" }))).toThrow(/could not be parsed/);
  });

  it("refuses a remote target — the realistic accident", () => {
    expect(() => assertLocalSeedTarget(env({ DATABASE_URL: "postgres://u:p@db.prod.example.com:5432/commish" }))).toThrow(
      /points at "db.prod.example.com"/,
    );
  });
});
