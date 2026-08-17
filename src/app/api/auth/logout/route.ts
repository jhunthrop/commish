import { cookies } from "next/headers";
import { clearSessionCookie, getAuthService } from "@/lib/auth/current-user";
import { AUTH_CONFIG } from "@/lib/auth/config";
import { ok } from "@/lib/api/respond";

export async function POST() {
  const store = await cookies();
  const sessionId = store.get(AUTH_CONFIG.sessionCookieName)?.value;
  if (sessionId !== undefined) {
    await getAuthService().logout(sessionId);
  }
  await clearSessionCookie();
  return ok({ loggedOut: true });
}
