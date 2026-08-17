import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { createAuthService, type AuthService, type AuthUser } from "./auth";
import { AUTH_CONFIG } from "./config";

const systemClock = { now: () => new Date().toISOString() };

let service: AuthService | undefined;

/** The one process-wide AuthService bound to the real DB and the real clock. */
export function getAuthService(): AuthService {
  if (service === undefined) {
    service = createAuthService({ db: getDb(), clock: systemClock });
  }
  return service;
}

/**
 * The single server-side identity seam. Every server component, route handler,
 * and server action that needs "who is this" calls this — never the cookie directly.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const store = await cookies();
  const sessionId = store.get(AUTH_CONFIG.sessionCookieName)?.value;
  if (sessionId === undefined) {
    return null;
  }
  return getAuthService().getUserBySession(sessionId);
}

export async function requireCurrentUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (user === null) {
    throw new Error("Not authenticated.");
  }
  return user;
}

export async function setSessionCookie(sessionId: string): Promise<void> {
  const store = await cookies();
  store.set(AUTH_CONFIG.sessionCookieName, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_CONFIG.sessionLifetimeDays * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(AUTH_CONFIG.sessionCookieName);
}
