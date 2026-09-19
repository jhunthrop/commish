import { describe, expect, it } from "vitest";
import { selfOrigin } from "./self-url";

describe("selfOrigin", () => {
  it("JOBS_SELF_URL wins, trailing slashes trimmed", () => {
    expect(selfOrigin({ JOBS_SELF_URL: "http://localhost:3151/", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "trycommish.app" })).toBe("http://localhost:3151");
  });

  it("production on Vercel is the production alias, never the protected deployment URL", () => {
    expect(selfOrigin({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "trycommish.app", VERCEL_URL: "commish-abc.vercel.app" })).toBe("https://trycommish.app");
  });

  it("a preview is its own deployment URL", () => {
    expect(selfOrigin({ VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "trycommish.app", VERCEL_URL: "commish-abc.vercel.app" })).toBe("https://commish-abc.vercel.app");
  });

  it("locally, the dev port, 3000 when none is set", () => {
    expect(selfOrigin({ PORT: "3100" })).toBe("http://localhost:3100");
    expect(selfOrigin({})).toBe("http://localhost:3000");
    expect(selfOrigin({ JOBS_SELF_URL: "", VERCEL_URL: "" })).toBe("http://localhost:3000");
  });
});
