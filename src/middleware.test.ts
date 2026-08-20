import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

const authkit = vi.fn();
const handleAuthkitProxy = vi.fn<(request: NextRequest, headers: unknown, options?: unknown) => string>();

vi.mock("@workos-inc/authkit-nextjs", () => ({
  authkit: (request: NextRequest) => authkit(request),
  handleAuthkitProxy: (request: NextRequest, headers: unknown, options?: unknown) => handleAuthkitProxy(request, headers, options),
}));

const { default: middleware } = await import("./middleware");

const AUTHORIZATION_URL = "https://auth.example/authorize";

function request(pathname: string, method = "GET"): NextRequest {
  return { method, nextUrl: { pathname } } as NextRequest;
}

/** Whether the call the middleware just made carried a redirect to hosted sign-in. */
function redirected(): boolean {
  const lastCall = handleAuthkitProxy.mock.calls.at(-1);
  return lastCall?.[2] !== undefined;
}

beforeEach(() => {
  authkit.mockReset();
  handleAuthkitProxy.mockClear();
  authkit.mockResolvedValue({ session: { user: null }, headers: new Headers(), authorizationUrl: AUTHORIZATION_URL });
});

describe("middleware — the /app redirect and its one exemption", () => {
  it("redirects a signed-out visitor away from /app itself", async () => {
    await middleware(request("/app"));
    expect(redirected()).toBe(true);
  });

  it.each(["/app/profile", "/app/leagues/abc", "/app/join", "/app/join/abc/deeper", "/app/joinery/abc"])(
    "still redirects a signed-out visitor from %s — the exemption is anchored at both ends and one segment wide",
    async (pathname) => {
      await middleware(request(pathname));
      expect(redirected()).toBe(true);
    },
  );

  it("lets a signed-out visitor render /app/join/<code>, the invite preview the decision record describes", async () => {
    await middleware(request("/app/join/ABC123"));
    expect(redirected()).toBe(false);
  });

  it("keeps the redirect for a non-GET to the exempt path — a page render is a GET", async () => {
    await middleware(request("/app/join/ABC123", "POST"));
    expect(redirected()).toBe(true);
  });

  it("never redirects a signed-in visitor, exempt path or not", async () => {
    authkit.mockResolvedValue({ session: { user: { id: "u1" } }, headers: new Headers(), authorizationUrl: AUTHORIZATION_URL });
    await middleware(request("/app/profile"));
    expect(redirected()).toBe(false);
  });

  it("never redirects outside /app at all", async () => {
    await middleware(request("/reviews"));
    expect(redirected()).toBe(false);
  });
});
