import type { NextRequest } from "next/server";
import { authkit, handleAuthkitProxy } from "@workos-inc/authkit-nextjs";

const PROTECTED_PAGE_PREFIX = "/app";

/**
 * The ONLY exemptions from the /app redirect, and deliberately the tightest expression of them.
 *
 * `/app/join/<code>` renders the league's terms to a signed-out visitor, because
 * `GET /api/invites/[code]` is unauthenticated on a documented ruling whose stated premise is
 * that a prospect sees what they are joining "before holding an account" — a premise that was
 * false in the shipped product while the only page consuming that route required a session.
 * The page's signed-out branch offers "Sign in to join" and no join button.
 *
 * TIGHT, three ways: anchored at both ends (`/app` itself, `/app/join`, and
 * `/app/join/a/b` all still redirect), one path segment only (`[^/]+`, so no traversal into a
 * deeper protected page), and GET only (a POST to this path is not a page render and keeps the
 * redirect). Everything else under /app is unchanged.
 */
const PUBLIC_APP_PAGES: readonly RegExp[] = [/^\/app\/join\/[^/]+$/];

function isPublicAppPage(request: NextRequest): boolean {
  return request.method === "GET" && PUBLIC_APP_PAGES.some((pattern) => pattern.test(request.nextUrl.pathname));
}

/**
 * WorkOS AuthKit session middleware. Runs on every non-static request so the session
 * headers withAuth() reads are present in pages, server actions, and API/SSE route
 * handlers alike.
 *
 * Only pages under /app redirect unauthenticated users to hosted sign-in, minus the exemptions
 * above. API routes never redirect — they return a JSON 401 themselves via getCurrentUser(), so
 * JSON/SSE clients get a JSON error, not an HTML redirect.
 */
export default async function middleware(request: NextRequest) {
  const { session, headers, authorizationUrl } = await authkit(request);
  const { pathname } = request.nextUrl;

  if (pathname.startsWith(PROTECTED_PAGE_PREFIX) && !isPublicAppPage(request) && !session.user && authorizationUrl) {
    return handleAuthkitProxy(request, headers, { redirect: authorizationUrl });
  }
  return handleAuthkitProxy(request, headers);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
