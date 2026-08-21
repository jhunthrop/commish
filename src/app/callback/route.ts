import { headers } from "next/headers";
import { handleAuth } from "@workos-inc/authkit-nextjs";
import { getDb } from "@/db/client";
import { syncUserFromWorkOS } from "@/lib/auth/user-sync";
import { firstForwardedFor } from "./forwarded-for";

const systemClock = { now: () => new Date().toISOString() };

/**
 * WorkOS AuthKit redirects here after hosted sign-in/sign-up. AuthKit sets the sealed
 * session cookie; we upsert our local profile row so teams/leagues have an FK target and
 * app-owned fields (experience tier, avatar) exist from the very first sign-in.
 *
 * This is also THE ONE PLACE `next/headers` is read for Task 7's device/IP signals (ruling 9: no
 * client beacon — `User-Agent`, `Accept-Language` and the request address are server-observed,
 * nothing more). They are handed to `syncUserFromWorkOS` through its `Deps.signals`, not read
 * inside `user-sync.ts` itself — that module has no business knowing it is inside a request, and
 * the seam is what lets its own tests fake this without a request at all.
 */
export const GET = handleAuth({
  returnPathname: "/app",
  onSuccess: async ({ user }) => {
    const requestHeaders = await headers();
    await syncUserFromWorkOS(
      {
        db: getDb(),
        clock: systemClock,
        via: "callback",
        signals: {
          userAgent: requestHeaders.get("user-agent"),
          acceptLanguage: requestHeaders.get("accept-language"),
          clientIp: firstForwardedFor(requestHeaders.get("x-forwarded-for")),
        },
      },
      user,
    );
  },
});
