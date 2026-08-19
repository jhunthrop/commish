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
