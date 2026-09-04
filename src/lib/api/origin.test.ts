import { afterEach, describe, expect, it } from "vitest";
import { originFor } from "./origin";

const request = new Request("https://evil.example.attacker/api/anything");

afterEach(() => {
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
});

describe("originFor", () => {
  it("configuration beats the request: a minted link never learns its host from a Host header", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://trycommish.app";
    expect(originFor(request)).toBe("https://trycommish.app");
  });

  it("falls back to Vercel's own production host, as https", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "trycommish.app";
    expect(originFor(request)).toBe("https://trycommish.app");
  });

  it("uses the request origin only when nothing is configured: the local-dev case", () => {
    expect(originFor(new Request("http://localhost:3000/api/anything"))).toBe("http://localhost:3000");
  });
});
