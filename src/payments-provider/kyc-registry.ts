import type { Clock } from "@research/domain/timing";
import { envOr } from "@research/lib/env";
import type { KycProvider } from "./kyc-contract";
import { createMockKycProvider } from "./mock/mock-kyc-provider";

/**
 * The KYC seam's own tunables — small enough to live beside the registry it configures rather
 * than in a fourth file, unlike `PAYMENTS_PROVIDER_CONFIG` (`./config.ts`), which several modules
 * (ingestion, the two routes) read. Nothing here reads this yet outside this file.
 *
 * `providers` lists ONLY `mock` this phase, on purpose — the same reasoning
 * `PAYMENTS_PROVIDER_CONFIG.providers` gives: a real bureau (Persona/Alloy class) is a founder-
 * gated future implementation, named here only once it passes `./kyc-contract-suite.ts` unchanged.
 */
export const KYC_PROVIDER_CONFIG = {
  providers: ["mock"] as const,
  /** Mock is the default for the same reason `PAYMENTS_PROVIDER_CONFIG.defaultProvider` is: a
   *  fresh clone gets a working (fake) KYC bureau with no vendor key and no BAA. */
  defaultProvider: "mock",
  envVars: {
    provider: "KYC_PROVIDER",
  },
} as const;

export type KycProviderName = (typeof KYC_PROVIDER_CONFIG.providers)[number];

export function isKycProviderName(value: string): value is KycProviderName {
  return (KYC_PROVIDER_CONFIG.providers as readonly string[]).includes(value);
}

/** A configured provider name that no implementation answers to — its own class, not a bare
 *  `Error`, mirroring `UnknownPaymentsProviderError` (`./registry.ts`) for the identical reason:
 *  the one thing that must never happen is a silent fallback to the mock for a deployment that
 *  believes it is verifying real identities. */
export class UnknownKycProviderError extends Error {
  readonly provider: string;
  constructor(provider: string) {
    super(`Unknown KYC provider "${provider}". Set ${KYC_PROVIDER_CONFIG.envVars.provider} to one of: ${KYC_PROVIDER_CONFIG.providers.join(", ")}.`);
    this.name = "UnknownKycProviderError";
    this.provider = provider;
  }
}

/** The wall clock, for the one place production code builds a provider. Tests inject their own. */
const systemClock: Clock = { now: () => new Date().toISOString() };

/**
 * The ONE place a KYC provider name becomes an implementation — `createPaymentsProvider`'s
 * machinery (`./registry.ts`), copied deliberately for the sibling seam.
 *
 * `envOr`, not `process.env[...] ?? default`, for the same reason `createPaymentsProvider` uses
 * it: `.env.example` may ship `KYC_PROVIDER=` as an intentionally-empty line, and `??` would
 * accept that empty string as a provider named `""` (`src/lib/env.ts`).
 */
export function createKycProvider(name: string = envOr(KYC_PROVIDER_CONFIG.envVars.provider, KYC_PROVIDER_CONFIG.defaultProvider)): KycProvider {
  if (!isKycProviderName(name)) throw new UnknownKycProviderError(name);
  return build(name);
}

function build(name: KycProviderName): KycProvider {
  switch (name) {
    case "mock":
      return createMockKycProvider(systemClock);
  }
}
