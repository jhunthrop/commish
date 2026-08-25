import { afterEach, describe, expect, it } from "vitest";
import { KYC_PROVIDER_CONFIG } from "./kyc-registry";
import { createKycProvider, UnknownKycProviderError } from "./kyc-registry";

afterEach(() => {
  delete process.env[KYC_PROVIDER_CONFIG.envVars.provider];
});

describe("createKycProvider", () => {
  it("defaults to the mock provider when nothing is configured", async () => {
    const provider = createKycProvider();
    const ref = await provider.submitVerification({
      userId: "user-registry",
      legalName: "Registry Person",
      dateOfBirth: "1990-01-01",
      minAge: 18,
      idempotencyKey: "registry-default",
    });
    await expect(provider.getStatus(ref)).resolves.toBe("pending");
  });

  it("reads the provider name from the environment", () => {
    process.env[KYC_PROVIDER_CONFIG.envVars.provider] = "persona";
    expect(() => createKycProvider()).toThrow(UnknownKycProviderError);
  });

  it("treats an empty environment value as unset, not as a provider named ''", () => {
    process.env[KYC_PROVIDER_CONFIG.envVars.provider] = "";
    expect(() => createKycProvider()).not.toThrow();
  });

  it("fails fast, by name, on a provider that does not exist", () => {
    expect(() => createKycProvider("alloy")).toThrow(UnknownKycProviderError);
    expect(() => createKycProvider("alloy")).toThrow('Unknown KYC provider "alloy". Set KYC_PROVIDER to one of: mock.');
  });

  it("never silently falls back to the mock for an unknown name", () => {
    process.env[KYC_PROVIDER_CONFIG.envVars.provider] = "definitely-not-a-provider";
    expect(() => createKycProvider()).toThrow(UnknownKycProviderError);
  });

  it("builds a working provider on the system clock", async () => {
    const provider = createKycProvider("mock");
    const ref = await provider.submitVerification({
      userId: "user-registry-clock",
      legalName: "Clock Person",
      dateOfBirth: "1990-01-01",
      minAge: 18,
      idempotencyKey: "registry-clock",
    });
    await expect(provider.getStatus(ref)).resolves.toBe("pending");
  });
});
