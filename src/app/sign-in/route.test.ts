import { describe, expect, it, vi } from "vitest";
import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { GET } from "./route";

// The SDK module is mocked, which is where this contract actually lives (Task 16 Step 1): the
// SDK itself decides how `returnTo` seals into the state, and `dist/esm/authkit-callback-route.
// js:76`'s own `returnPathnameState ?? returnPathnameOption` is what makes that value beat the
// callback's fixed fallback once it comes back — this route's whole job is to hand `getSignInUrl`
// the right argument, never to prove what the SDK does with it. `next/navigation`'s `redirect`
// always throws its own control-flow signal, real or mocked; mocked here as a no-op so the tests
// below can assert on `getSignInUrl`'s call without a request/render context to catch it.
vi.mock("@workos-inc/authkit-nextjs", () => ({ getSignInUrl: vi.fn().mockResolvedValue("https://example.authkit.app/authorize") }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

describe("GET /sign-in", () => {
  it("asks WorkOS to come back to the visitor's own intent", async () => {
    await GET(new Request("http://localhost/sign-in?returnTo=%2Fjoin%2Flg%2Fhold"));
    expect(getSignInUrl).toHaveBeenCalledWith({ returnTo: "/join/lg/hold" });
  });

  it("ignores an intent it would not trust, and still signs the person in", async () => {
    await GET(new Request("http://localhost/sign-in?returnTo=https%3A%2F%2Fevil.example"));
    expect(getSignInUrl).toHaveBeenCalledWith({});
  });

  it("signs in plainly when there is no returnTo at all", async () => {
    await GET(new Request("http://localhost/sign-in"));
    expect(getSignInUrl).toHaveBeenCalledWith({});
  });
});
