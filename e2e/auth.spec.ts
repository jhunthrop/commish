import { expect, test } from "./support/fixtures";

/**
 * The way in, stopped at the boundary (Task 16 Step 6). Three tests, none of which touches a
 * hosted form: A2 (the parent's Global Constraints, incorporated here) is absolute — a spec may
 * assert that a click leaves our origin, that the destination carries our `redirect_uri` and a
 * `state` parameter, and that a `returnTo` we set arrives where it should, but no spec here ever
 * types into the WorkOS hosted form and no spec stubs the WorkOS domain.
 */

test("from /reviews signed out, Sign in leaves our origin for the AuthKit host, carrying our redirect_uri and a state param", async ({ page }) => {
  await page.goto("/reviews");
  const ownOrigin = new URL(page.url()).origin;

  // Click-and-verify, retried (the SSR-fake discipline): `SignInLink` renders a real `<a href>`,
  // so even a pre-hydration click still fires a real browser navigation — asserted against the
  // actual receipt (having left our own origin) rather than trusted on the click alone.
  await expect(async () => {
    await page.getByRole("link", { name: "Sign in" }).first().click();
    await page.waitForURL((url) => url.origin !== ownOrigin, { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });

  const destination = new URL(page.url());
  expect(destination.origin).not.toBe(ownOrigin);

  expect(destination.searchParams.get("state")).toBeTruthy();
  const redirectUri = destination.searchParams.get("redirect_uri");
  expect(redirectUri).toBeTruthy();
  // The redirect_uri is OUR OWN callback route — the thing WorkOS will hand the visitor back to
  // once they finish on its side. Its ORIGIN is `NEXT_PUBLIC_WORKOS_REDIRECT_URI`
  // (`.env.local`), a value independent of `E2E_BASE_URL`/this run's own port (see playwright.
  // config.ts's own documented port-3100 deviation), so only the path is asserted here.
  expect(new URL(redirectUri!).pathname).toBe("/callback");
});

test("/sign-in with a hostile returnTo still leaves for AuthKit, and the hostile value appears nowhere in the outgoing URL", async ({ page }) => {
  await page.goto("/");
  const ownOrigin = new URL(page.url()).origin;

  const hostile = "https://evil.example";
  await page.goto(`/sign-in?returnTo=${encodeURIComponent(hostile)}`);

  const destination = page.url();
  expect(new URL(destination).origin).not.toBe(ownOrigin);
  expect(destination).not.toContain("evil.example");
  expect(destination).not.toContain(encodeURIComponent(hostile));
});

/**
 * Re-verifies `e2e/season.spec.ts`'s own sign-out coverage now that the chrome the "Sign out"
 * button lives in moved (`TopBar`'s inner row gained `SessionNotice` beside it, Task 16 Step 5) —
 * deliberately re-run here rather than moved, so `season.spec.ts`'s own regression net over the
 * season lifecycle stays intact. See that file's own docblock for the CSP history this protects:
 * `form-action` must name BOTH `api.workos.com` and the hosted `.authkit.app` domain, or the
 * sign-out chain is silently refused partway through and the next sign-in resumes the old
 * identity.
 */
test("sign-out through managerSignOut still walks the whole WorkOS chain and lands back on our own origin", async ({ managerSignOut }) => {
  const navigations: string[] = [];
  managerSignOut.on("request", (request) => {
    if (request.isNavigationRequest()) navigations.push(new URL(request.url()).host);
  });

  await managerSignOut.goto("/app");
  await expect(managerSignOut.getByRole("heading", { name: "Your leagues" })).toBeVisible();

  await managerSignOut.getByRole("button", { name: "Sign out" }).click();

  await expect
    .poll(() => navigations.includes("api.workos.com"), { message: "the sign-out POST never reached WorkOS's logout endpoint" })
    .toBe(true);
  await expect
    .poll(() => navigations.some((host) => host.endsWith(".authkit.app")), {
      message: "the WorkOS logout redirect to the hosted AuthKit domain was refused",
    })
    .toBe(true);

  // Where hop 4 lands is a WorkOS dashboard setting, not this app's code, so this asserts the
  // STATE (the session is gone, the product offers the way back in) rather than the destination.
  await managerSignOut.goto("/browse");
  await expect(managerSignOut.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  await expect(managerSignOut.getByRole("button", { name: "Sign out" })).toHaveCount(0);
});
