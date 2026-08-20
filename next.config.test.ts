import { describe, it, expect } from "vitest";
import nextConfig, { contentSecurityPolicy, securityHeaders } from "./next.config";

/**
 * The security headers were pinned by nothing: they shipped, the e2e suite happened to stay
 * green under them, and a single edit to the policy string could have loosened or broken any
 * directive without a single test noticing. That is exactly how `form-action 'self'` shipped
 * while silently breaking the WorkOS sign-out redirect.
 *
 * This asserts on `next.config.ts`'s OWN exports, not on a hand-copied lookalike, so a weakened
 * CSP reddens here rather than being discovered in a browser.
 */
describe("security headers", () => {
  it("applies all four headers to every path", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe("/:path*");
    expect(rules[0]!.headers.map((header) => header.key).sort()).toEqual([
      "Content-Security-Policy",
      "Referrer-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
    ]);
  });

  it("serves the exact non-CSP header values, not merely the keys", () => {
    const byKey = new Map(securityHeaders().map((header) => [header.key, header.value]));
    expect(byKey.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(byKey.get("X-Content-Type-Options")).toBe("nosniff");
    expect(byKey.get("X-Frame-Options")).toBe("DENY");
  });

  // The HIGH this test exists for. `AppHeader`'s Sign out is a real form POST, and `signOut()`
  // answers it with a redirect to WorkOS's hosted logout endpoint; Chromium enforces
  // `form-action` across the whole redirect chain, so dropping this origin clears the local
  // cookie and leaves the IdP session alive.
  it("lets the sign-out form walk the whole WorkOS chain, and nothing else", () => {
    // Three hops, all of which Chromium checks: this app, WorkOS's API, and the hosted AuthKit
    // domain the logout endpoint bounces through. Dropping EITHER origin breaks sign-out while
    // leaving the local cookie cleared, so both are named.
    expect(contentSecurityPolicy("production")).toContain("form-action 'self' https://api.workos.com https://*.authkit.app");
    // The misconfiguration destination stays out: hop 3 lands there only when a WorkOS
    // environment has no app homepage url set.
    expect(contentSecurityPolicy("production")).not.toContain("error.workos.com");
  });

  it("keeps every directive the shipped policy depends on", () => {
    const csp = contentSecurityPolicy("production");
    for (const directive of [
      "default-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      // The one control that makes all three third-party <img> sinks safe by construction.
      "img-src 'self' https: data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ]) {
      expect(csp).toContain(directive);
    }
  });

  it("never ships 'unsafe-eval', and always allows it in dev, where webpack needs it", () => {
    // `headers()` applies to `next dev` too, and its `eval-source-map` devtool wraps every
    // module in `eval()`. Production must not carry the same relaxation.
    expect(contentSecurityPolicy("production")).toContain("script-src 'self' 'unsafe-inline';");
    expect(contentSecurityPolicy("production")).not.toContain("'unsafe-eval'");
    expect(contentSecurityPolicy("test")).not.toContain("'unsafe-eval'");
    expect(contentSecurityPolicy(undefined)).not.toContain("'unsafe-eval'");
    expect(contentSecurityPolicy("development")).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval';");
  });
});
