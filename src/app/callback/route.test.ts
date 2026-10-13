import { describe, expect, it, vi } from "vitest";
import type { HandleAuthOptions } from "@workos-inc/authkit-nextjs";
import type { NextRequest } from "next/server";

// The SDK module is mocked, which is where this contract lives — mirrors `sign-in/route.test.ts`'s
// own mocking pattern. `handleAuth` is captured rather than exercised for real, so `onError` can
// be invoked directly with a fake request, with no real WorkOS callback round trip needed to prove
// what this route hands back on a failure. `vi.hoisted` (not a plain `let`): every top-level
// `import` in this file — including the bare `import "./route"` below, whose whole point is to
// trigger `handleAuth(...)` as a side effect — runs before ordinary statements regardless of
// where they're written, so a plain `let capturedOptions` would still be in its temporal dead
// zone when the mock factory closure ran.
const captured = vi.hoisted(() => ({ options: undefined as HandleAuthOptions | undefined }));
vi.mock("@workos-inc/authkit-nextjs", () => ({
  handleAuth: vi.fn((options: HandleAuthOptions) => {
    captured.options = options;
    return vi.fn();
  }),
}));
// Never called by `onError` itself, but imported at module scope by `route.ts` — mocked so
// importing the module has no real side effect (no request context, no database).
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@research-ts/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth/user-sync", () => ({ syncUserFromWorkOS: vi.fn() }));

import "./route";

describe("callback/route.ts's onError", () => {
  it("redirects to exactly /sign-in/problem, with no query string and no leaked error detail", async () => {
    const onError = captured.options?.onError;
    expect(onError).toBeDefined();

    const request = new Request("http://localhost/callback?code=abc&state=xyz") as unknown as NextRequest;
    // A realistic failure: an underlying error carrying something that must never reach the
    // visitor (a fragment of a secret, an internal detail).
    const error = new Error("token exchange failed: client_secret=super-secret-value-abc123");

    const response = await onError!({ error, request });

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    const location = response.headers.get("location");
    expect(location).not.toBeNull();

    const destination = new URL(location!);
    expect(destination.pathname).toBe("/sign-in/problem");
    // Exactly `/sign-in/problem` — no query string at all, since this route cannot reliably
    // recover the visitor's original intent from a failed callback (see route.ts's own docblock).
    expect(destination.search).toBe("");

    // No leaked error detail anywhere in the response — not in the redirect target, not in any
    // header, not in a body.
    const headerText = JSON.stringify([...response.headers.entries()]);
    expect(headerText).not.toContain("token exchange failed");
    expect(headerText).not.toContain("super-secret-value-abc123");
    const bodyText = await response.text();
    expect(bodyText).not.toContain("token exchange failed");
    expect(bodyText).not.toContain("super-secret-value-abc123");
  });
});
