/**
 * The ONE place this repo reads an optional environment variable with a fallback.
 *
 * `.env.example` deliberately ships several vars as intentionally-empty lines (`E2E_BASE_URL=`,
 * `DEV_SEED_CLAIM_USER_ID=`, `LAB_EMAIL=`, `LAB_PASSWORD=`, `ANTHROPIC_API_KEY=`, …) so a fresh
 * `.env.local` copy documents every var this repo reads even when the developer has no value for
 * it yet. dotenv (and dotenv-cli) reads that line as `process.env.VAR = ""`, not as an absent key
 * — so a plain `process.env.VAR ?? default` is defeated: `??` only falls back on
 * `undefined`/`null`, never on `""`. An empty string is not the same thing as unset, and every
 * site that reads an optional env var with a fallback must treat it that way. Use `envOr` (or
 * `undefined`/`??` only after an explicit `=== ""` check) instead of a bare `??` wherever
 * `.env.example` ships the var empty.
 *
 * It lives under `src/lib/` and NOT under `scripts/lib/` because `src/data/seed/index.ts` needs
 * it, and source code must never import upward out of the source root. `scripts/**` may import
 * `src/**` (it already does, via `@/`); the reverse direction is banned in `eslint.config.mjs`.
 */
export function envOr(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

/** Same rule as `envOr`, for the common case of "give me `undefined`, not `""`, when unset." */
export function envOrUndefined(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

/**
 * A boundary value from `.env.local`, not from code, so it is validated here rather than
 * trusted. `Number("banana")` is `NaN`, and an unvalidated `NaN` is worse than a crash in every
 * consumer this has: a season stringified straight onto a query string ships the literal `"NaN"`,
 * a poll interval of `NaN` makes `setInterval` fire continuously, and a request budget of `NaN`
 * compares false against every ceiling.
 *
 * Lives here rather than in one consumer because three modules now need the identical rule
 * (`src/stats/registry.ts`'s season and mock live week, `src/stats-pipeline/settings.ts`'s poll
 * interval and monthly budget). The error names the VARIABLE, never just the value, because the
 * whole point of failing fast on a boundary value is telling the operator which line of
 * `.env.local` to fix.
 */
export function parsePositiveInteger(name: string, raw: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name}="${raw}" is not a positive integer.`);
  }
  return parsed;
}

/** A variable the process cannot run without: its value, or a named failure at the start of a run
 *  rather than a confusing one deep inside it. */
export function requireEnv(name: string): string {
  const value = envOrUndefined(name);
  if (value === undefined) throw new Error(`${name} is not set. Put it in .env.local, or in the job's environment.`);
  return value;
}
