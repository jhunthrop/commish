import type { Clock } from "@/domain/timing";
import { envOr } from "@/lib/env";
import { isPaymentsProviderName, PAYMENTS_PROVIDER_CONFIG, type PaymentsProviderName } from "./config";
import type { PaymentsProvider } from "./contract";
import { createMockPaymentsProvider } from "./mock/mock-payments-provider";

/**
 * A configured provider name that no implementation answers to.
 *
 * Its own class, not a bare `Error`, because the one thing that must never happen here is a
 * silent fallback — and here the stats registry's argument compounds: a deployment configured
 * for a real money rail that quietly serves the mock would ACCEPT deposits that deposit
 * nothing, and look completely healthy doing it.
 */
export class UnknownPaymentsProviderError extends Error {
  readonly provider: string;
  constructor(provider: string) {
    super(
      `Unknown payments provider "${provider}". Set ${PAYMENTS_PROVIDER_CONFIG.envVars.provider} to one of: ${PAYMENTS_PROVIDER_CONFIG.providers.join(", ")}.`,
    );
    this.name = "UnknownPaymentsProviderError";
    this.provider = provider;
  }
}

/** The wall clock, for the one place production code builds a provider. Tests inject their own. */
const systemClock: Clock = { now: () => new Date().toISOString() };

/**
 * The ONE place a provider name becomes an implementation — `createStatsProvider`'s machinery,
 * copied deliberately (`src/stats/registry.ts`).
 *
 * `envOr`, not `process.env[...] ?? default`: `.env.example` may ship `PAYMENTS_PROVIDER=` as an
 * intentionally-empty line, and dotenv reads that as `""`, which `??` would happily accept as a
 * provider named empty string. See `src/lib/env.ts`.
 *
 * The `build` switch has ONLY a `mock` arm this phase, on purpose. The real rails — Column,
 * Aeropay, Paysafe (founder decisions 2-4) — are founder-gated future implementations: an arm
 * may be added here only for an adapter that passes `runPaymentsProviderContractSuite`
 * UNCHANGED, ACH-return case included, and whose name the founder has signed off. `docs/money.md`
 * records the same rule from the product side.
 */
export function createPaymentsProvider(
  name: string = envOr(PAYMENTS_PROVIDER_CONFIG.envVars.provider, PAYMENTS_PROVIDER_CONFIG.defaultProvider),
): PaymentsProvider {
  if (!isPaymentsProviderName(name)) throw new UnknownPaymentsProviderError(name);
  return build(name);
}

function build(name: PaymentsProviderName): PaymentsProvider {
  switch (name) {
    case "mock":
      return createMockPaymentsProvider(systemClock);
  }
}
