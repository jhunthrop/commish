import { describe, expect, it, vi } from "vitest";
import { getSignUpUrl } from "@workos-inc/authkit-nextjs";
import { GET } from "./route";

// The identical shape as `sign-in/route.test.ts` over `getSignUpUrl` — see that file's own
// docblock for why both modules are mocked.
vi.mock("@workos-inc/authkit-nextjs", () => ({ getSignUpUrl: vi.fn().mockResolvedValue("https://example.authkit.app/authorize") }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

describe("GET /sign-up", () => {
  it("asks WorkOS to come back to the visitor's own intent", async () => {
    await GET(new Request("http://localhost/sign-up?returnTo=%2Fjoin%2Flg%2Fhold"));
    expect(getSignUpUrl).toHaveBeenCalledWith({ returnTo: "/join/lg/hold" });
  });

  it("ignores an intent it would not trust, and still offers sign-up", async () => {
    await GET(new Request("http://localhost/sign-up?returnTo=https%3A%2F%2Fevil.example"));
    expect(getSignUpUrl).toHaveBeenCalledWith({});
  });

  it("signs up plainly when there is no returnTo at all", async () => {
    await GET(new Request("http://localhost/sign-up"));
    expect(getSignUpUrl).toHaveBeenCalledWith({});
  });
});
