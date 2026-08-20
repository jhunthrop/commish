import { afterEach, describe, expect, it } from "vitest";
import { GIF_CONFIG } from "./config";
import { GIPHY_CONFIG } from "./giphy/config";
import { createGifProvider, UnknownGifProviderError } from "./registry";

afterEach(() => {
  delete process.env[GIF_CONFIG.envVars.provider];
  delete process.env[GIPHY_CONFIG.envVars.apiKey];
});

describe("createGifProvider", () => {
  it("returns null when nothing is configured — the unconfigured-degrade default", () => {
    expect(createGifProvider()).toBeNull();
  });

  it("treats an empty environment value as unset, not as a provider named ''", () => {
    process.env[GIF_CONFIG.envVars.provider] = "";
    expect(createGifProvider()).toBeNull();
  });

  it("reads the provider name from the environment", () => {
    process.env[GIF_CONFIG.envVars.provider] = "none";
    expect(createGifProvider()).toBeNull();
  });

  it("fails fast, by name, on a provider that does not exist", () => {
    expect(() => createGifProvider("tenor")).toThrow(UnknownGifProviderError);
    expect(() => createGifProvider("tenor")).toThrow('Unknown GIF provider "tenor". Set GIF_PROVIDER to one of: none, giphy.');
  });

  it("never silently falls back to none for an unknown name", () => {
    // The failure mode this guards against: a deployment that thinks GIFs are configured and is
    // quietly serving the unconfigured-degrade path instead — no error, no button, no evidence.
    process.env[GIF_CONFIG.envVars.provider] = "definitely-not-a-provider";
    expect(() => createGifProvider()).toThrow(UnknownGifProviderError);
  });

  it("refuses giphy without a key, and says which variable to set", () => {
    expect(() => createGifProvider("giphy")).toThrow(GIPHY_CONFIG.envVars.apiKey);
  });

  it("builds giphy when a key is present, without making any request", () => {
    process.env[GIPHY_CONFIG.envVars.apiKey] = "test-key";
    expect(() => createGifProvider("giphy")).not.toThrow();
    expect(createGifProvider("giphy")).not.toBeNull();
  });

  it("selects giphy through the env var, and proves it by observing a request the null provider never would", async () => {
    process.env[GIF_CONFIG.envVars.provider] = "giphy";
    process.env[GIPHY_CONFIG.envVars.apiKey] = "test-key";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("env-selected giphy provider attempted a real request");
    }) as typeof globalThis.fetch;
    try {
      const provider = createGifProvider();
      expect(provider).not.toBeNull();
      await expect(provider!.search("touchdown", 5)).rejects.toThrow("env-selected giphy provider attempted a real request");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
