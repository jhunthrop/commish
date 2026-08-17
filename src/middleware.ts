import type { NextRequest } from "next/server";
import { authkit, handleAuthkitProxy } from "@workos-inc/authkit-nextjs";

const PROTECTED_PAGE_PREFIX = "/app";

/**
 * WorkOS AuthKit session middleware. Runs on every non-static request so the session
 * headers withAuth() reads are present in pages, server actions, and API/SSE route
 * handlers alike.
 *
 * Only pages under /app redirect unauthenticated users to hosted sign-in. API routes never
 * redirect — they return a JSON 401 themselves via getCurrentUser(), so JSON/SSE clients
 * get a JSON error, not an HTML redirect.
 */
export default async function middleware(request: NextRequest) {
  const { session, headers, authorizationUrl } = await authkit(request);
  const { pathname } = request.nextUrl;

  if (pathname.startsWith(PROTECTED_PAGE_PREFIX) && !session.user && authorizationUrl) {
    return handleAuthkitProxy(request, headers, { redirect: authorizationUrl });
  }
  return handleAuthkitProxy(request, headers);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
