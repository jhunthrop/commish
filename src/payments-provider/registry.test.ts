import { afterEach, describe, expect, it } from "vitest";
import { PAYMENTS_PROVIDER_CONFIG } from "./config";
import { createPaymentsProvider, UnknownPaymentsProviderError } from "./registry";

afterEach(() => {
  delete process.env[PAYMENTS_PROVIDER_CONFIG.envVars.provider];
});

describe("createPaymentsProvider", () => {
  it("defaults to the mock provider when nothing is configured", () => {
    const provider = createPaymentsProvider();
    // The mock reports both configured rails; a fresh clone gets a working (fake) money rail.
    expect(provider.listSupportedMethods().map((m) => m.method)).toEqual(["bank", "card"]);
  });

  it("reads the provider name from the environment", () => {
    // With mock the only implementation, PAYMENTS_PROVIDER=mock is indistinguishable from the
    // default — so the proof that the env var is actually read is that an unknown value there
    // is what the failure names.
    process.env[PAYMENTS_PROVIDER_CONFIG.envVars.provider] = "column";
    expect(() => createPaymentsProvider()).toThrow(UnknownPaymentsProviderError);
  });

  it("treats an empty environment value as unset, not as a provider named ''", () => {
    process.env[PAYMENTS_PROVIDER_CONFIG.envVars.provider] = "";
    expect(() => createPaymentsProvider()).not.toThrow();
  });

  it("fails fast, by name, on a provider that does not exist", () => {
    expect(() => createPaymentsProvider("aeropay")).toThrow(UnknownPaymentsProviderError);
    expect(() => createPaymentsProvider("aeropay")).toThrow(
      'Unknown payments provider "aeropay". Set PAYMENTS_PROVIDER to one of: mock.',
    );
  });

  it("never silently falls back to the mock for an unknown name", () => {
    // The worst available failure mode: a deployment that thinks it is on a real money rail,
    // quietly accepting deposits into a mock that deposits nothing.
    process.env[PAYMENTS_PROVIDER_CONFIG.envVars.provider] = "definitely-not-a-provider";
    expect(() => createPaymentsProvider()).toThrow(UnknownPaymentsProviderError);
  });

  it("builds a working provider on the system clock, stamping real time on an intent", async () => {
    const provider = createPaymentsProvider("mock");
    await provider.ensureAccount("user-registry");
    const before = Date.now();
    const intent = await provider.initiateDeposit({
      userId: "user-registry",
      amountCents: 5_00,
      method: "bank",
      idempotencyKey: "registry-clock",
    });
    const stamped = Date.parse(intent.initiatedAt);
    expect(stamped).toBeGreaterThanOrEqual(before - 1);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1);
  });
});
