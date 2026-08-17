import { handleAuth } from "@workos-inc/authkit-nextjs";
import { getDb } from "@/db/client";
import { syncUserFromWorkOS } from "@/lib/auth/user-sync";

const systemClock = { now: () => new Date().toISOString() };

/**
 * WorkOS AuthKit redirects here after hosted sign-in/sign-up. AuthKit sets the sealed
 * session cookie; we upsert our local profile row so teams/leagues have an FK target and
 * app-owned fields (experience tier, avatar) exist from the very first sign-in.
 */
export const GET = handleAuth({
  returnPathname: "/app",
  onSuccess: async ({ user }) => {
    await syncUserFromWorkOS({ db: getDb(), clock: systemClock }, user);
  },
});
