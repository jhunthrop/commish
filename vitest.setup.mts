import "@testing-library/jest-dom/vitest";
import { afterEach, expect } from "vitest";
import { cleanup } from "@testing-library/react";
import * as axeMatchers from "vitest-axe/matchers";
import type { AxeMatchers } from "vitest-axe/matchers";

// vitest.config.mts sets `globals: false`, so @testing-library/react's automatic
// afterEach(cleanup) (which relies on global test hooks) never registers. Register
// it once here so every RTL test file unmounts between tests without boilerplate.
afterEach(() => {
  cleanup();
});

// `npm test` is plain `vitest run` — nothing here loads `.env.local` the way `next dev`/`next
// build` do or `dotenv -e .env.local --` does for the scripts that need it. `TEST_DATABASE_URL`
// gets away with this because `createTestDb` (`src/db/test-db.ts`) reads it through `envOr` with
// a hardcoded fallback matching docker-compose's defaults. `SESSION_SIGNAL_SALT`
// (`src/integrity-service/session-signals.ts`) intentionally has NO such fallback in production
// code — a salt that silently defaults to a constant is a salt that does nothing — so the
// equivalent fallback lives here instead, set once for the whole suite rather than duplicated
// into every test file that exercises `recordSessionSignals`/`syncUserFromWorkOS`. `??=` leaves a
// real value from the environment untouched if one is ever exported before the run.
process.env.SESSION_SIGNAL_SALT ??= "vitest-suite-session-signal-salt-not-for-any-real-use";

// vitest-axe@0.1.0's own "vitest-axe/extend-expect" entry point ships an empty
// dist/extend-expect.js (a broken build published to npm — verified against the
// registry tarball, not an install artifact of this machine) and its .d.ts targets
// vitest's pre-1.0 `declare global { namespace Vi { ... } }` typing pattern, which
// current vitest (module-augmentation-based `declare module "vitest"`) no longer
// picks up. Register the matcher at runtime and re-declare its type ourselves,
// mirroring the pattern @testing-library/jest-dom/vitest uses.
expect.extend(axeMatchers);

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars -- declaration-merging interface must match vitest's own `Assertion<T = any>` signature exactly
  interface Assertion<T = any> extends AxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merging interface, adds no new members by design
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
