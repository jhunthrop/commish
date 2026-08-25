/**
 * Every tunable the payments seam has, mirroring `STATS_CONFIG` (`src/stats/config.ts`) —
 * the seam machinery the plan tells this directory to copy by name.
 *
 * `providers` lists ONLY `mock` this phase, on purpose. The real rails the dossier scores —
 * Column, Aeropay, Paysafe (founder decisions 2-4) — are founder-gated future implementations:
 * an arm may not be named here until its adapter passes `./contract-suite.ts` unchanged, the
 * same bar the mock passes. Unlike `STATS_CONFIG`'s early `tank01` entry, no real name is
 * pre-listed, because pre-listing a MONEY rail would put a selectable-but-imaginary payment
 * processor one env var away from a deployment.
 */
export const PAYMENTS_PROVIDER_CONFIG = {
  providers: ["mock"] as const,
  /**
   * Mock is the default for the same reason `STATS_CONFIG` defaults to mock: a developer who
   * has just cloned the repo should get a working (fake) money rail with no key and no bank
   * relationship, and a deployment that wants real money movement should have to say so.
   */
  defaultProvider: "mock",
  envVars: {
    provider: "PAYMENTS_PROVIDER",
    /**
     * The shared secret the provider signs callback bodies with and `ingestProviderCallback`
     * verifies against. Optional while the only provider is the mock (which falls back to
     * `mockWebhookSecret` below); a real provider arm must REQUIRE it and fail fast when it is
     * absent, the way `STATS_PROVIDER=tank01` requires `TANK01_API_KEY`.
     */
    webhookSecret: "PAYMENTS_WEBHOOK_SECRET",
  },
  /**
   * The HTTP header carrying the lowercase hex HMAC-SHA256 signature of the raw callback body.
   * Task 5's webhook route reads THIS name and hands the value to `ingestProviderCallback` —
   * one constant, so the route and the verifier can never disagree about which header it is.
   */
  webhookSignatureHeader: "x-payments-signature",
  /**
   * The mock's development-only signing secret — deliberately NOT a secret. It exists so the
   * mock can exercise the full signed-callback path (sign, deliver, verify, refuse a tamper)
   * with zero setup, and it guards nothing: the mock moves no money. Any REAL provider arm
   * must require `PAYMENTS_WEBHOOK_SECRET` instead; this constant is the fallback only the
   * mock may ride on.
   */
  mockWebhookSecret: "commish-mock-payments-dev-secret-not-for-production",
} as const;

export type PaymentsProviderName = (typeof PAYMENTS_PROVIDER_CONFIG.providers)[number];

export function isPaymentsProviderName(value: string): value is PaymentsProviderName {
  return (PAYMENTS_PROVIDER_CONFIG.providers as readonly string[]).includes(value);
}
