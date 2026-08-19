import { afterEach, describe, expect, it } from "vitest";
import { STATS_INGESTION_CONFIG } from "./config";
import { resolveIngestionSettings } from "./settings";

const { mode: MODE_VAR, pollIntervalMs: INTERVAL_VAR, monthlyRequestBudget: BUDGET_VAR } = STATS_INGESTION_CONFIG.envVars;

function clearOverrides(): void {
  delete process.env[MODE_VAR];
  delete process.env[INTERVAL_VAR];
  delete process.env[BUDGET_VAR];
}

afterEach(clearOverrides);

describe("resolveIngestionSettings", () => {
  it("falls back to the shipped config when nothing is set", () => {
    clearOverrides();
    expect(resolveIngestionSettings()).toEqual({
      mode: STATS_INGESTION_CONFIG.mode,
      pollIntervalMs: STATS_INGESTION_CONFIG.pollIntervalMs,
      monthlyRequestBudget: STATS_INGESTION_CONFIG.monthlyRequestBudget,
    });
  });

  it("treats an intentionally-empty .env.example line as unset rather than as a value", () => {
    // All three ship commented-out or empty in `.env.example`; dotenv reads an empty line as `""`,
    // which a bare `??` would accept as a mode named empty string. See `src/lib/env.ts`.
    process.env[MODE_VAR] = "";
    process.env[INTERVAL_VAR] = "";
    process.env[BUDGET_VAR] = "";
    expect(resolveIngestionSettings()).toEqual({
      mode: STATS_INGESTION_CONFIG.mode,
      pollIntervalMs: STATS_INGESTION_CONFIG.pollIntervalMs,
      monthlyRequestBudget: STATS_INGESTION_CONFIG.monthlyRequestBudget,
    });
  });

  it("reads STATS_INGESTION_MODE — the whole of the documented launch rollout", () => {
    process.env[MODE_VAR] = "live";
    expect(resolveIngestionSettings().mode).toBe("live");
  });

  it("reads STATS_POLL_INTERVAL_MS", () => {
    process.env[INTERVAL_VAR] = "60000";
    expect(resolveIngestionSettings().pollIntervalMs).toBe(60_000);
  });

  it("reads STATS_MONTHLY_REQUEST_BUDGET", () => {
    process.env[BUDGET_VAR] = "12000";
    expect(resolveIngestionSettings().monthlyRequestBudget).toBe(12_000);
  });

  it("fails fast on a mode it does not recognize, naming the variable and every legal spelling", () => {
    process.env[MODE_VAR] = "live-ish";
    expect(() => resolveIngestionSettings()).toThrow(/STATS_INGESTION_MODE="live-ish"/);
    expect(() => resolveIngestionSettings()).toThrow(/final-only, live/);
  });

  it("fails fast on a poll interval that is not a positive integer, naming the variable", () => {
    process.env[INTERVAL_VAR] = "banana";
    expect(() => resolveIngestionSettings()).toThrow(/STATS_POLL_INTERVAL_MS="banana"/);
  });

  it("fails fast on a monthly budget that is not a positive integer, naming the variable", () => {
    process.env[BUDGET_VAR] = "0";
    expect(() => resolveIngestionSettings()).toThrow(/STATS_MONTHLY_REQUEST_BUDGET="0"/);
  });
});
