import { envOr, envOrUndefined, parsePositiveInteger } from "@/lib/env";
import { isIngestionMode, INGESTION_MODES, STATS_INGESTION_CONFIG, type IngestionMode } from "./config";

/** The three tunables an operator may move without a deploy, resolved once at the edge. */
export interface IngestionSettings {
  readonly mode: IngestionMode;
  readonly pollIntervalMs: number;
  readonly dailyRequestBudget: number;
}

/**
 * `STATS_INGESTION_CONFIG`'s three declared environment overrides, actually read.
 *
 * They are resolved HERE — one function, called once at the edge (`./index.ts`) — rather than at
 * each point of use, for the same reason `createStatsProvider` is the one place a provider name
 * becomes an implementation: a control an operator is told exists must have exactly one reader,
 * or "is it wired?" becomes a grep rather than a fact. All three shipped as declarations with no
 * reader at all until this existed, which meant `STATS_INGESTION_MODE=live` — the documented
 * whole of the launch rollout — silently did nothing.
 *
 * `envOr`/`envOrUndefined` rather than a bare `process.env[...] ?? default`: `.env.example` ships
 * all three as intentionally-empty lines, which dotenv reads as `""` and `??` happily accepts.
 * See `src/lib/env.ts`.
 *
 * Garbage FAILS FAST, naming the variable, mirroring `registry.ts`'s handling of
 * `STATS_PROVIDER`. A misspelled mode that silently fell back to the default would be the same
 * class of bug this function exists to remove: a deployment that looks configured and is not.
 */
export function resolveIngestionSettings(): IngestionSettings {
  const modeVar = STATS_INGESTION_CONFIG.envVars.mode;
  const mode = envOr(modeVar, STATS_INGESTION_CONFIG.mode);
  if (!isIngestionMode(mode)) {
    throw new Error(`${modeVar}="${mode}" is not an ingestion mode. Use one of: ${INGESTION_MODES.join(", ")}.`);
  }

  const intervalVar = STATS_INGESTION_CONFIG.envVars.pollIntervalMs;
  const rawInterval = envOrUndefined(intervalVar);
  const budgetVar = STATS_INGESTION_CONFIG.envVars.dailyRequestBudget;
  const rawBudget = envOrUndefined(budgetVar);

  return {
    mode,
    pollIntervalMs: rawInterval === undefined ? STATS_INGESTION_CONFIG.pollIntervalMs : parsePositiveInteger(intervalVar, rawInterval),
    dailyRequestBudget: rawBudget === undefined ? STATS_INGESTION_CONFIG.dailyRequestBudget : parsePositiveInteger(budgetVar, rawBudget),
  };
}
