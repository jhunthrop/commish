import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sessions, users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import type { User } from "@/domain/user";
import { AUTH_CONFIG } from "./config";

export interface AuthUser extends User {
  readonly email: string;
}

export type AuthResult =
  | { readonly ok: true; readonly user: AuthUser; readonly sessionId: string }
  | { readonly ok: false; readonly reason: string };

interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

interface LoginInput {
  readonly email: string;
  readonly password: string;
}

interface AuthServiceDeps {
  readonly db: Db;
  readonly clock: Clock;
}

const GENERIC_LOGIN_FAILURE = "Incorrect email or password.";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("base64url")}`;
}

function newSessionId(): string {
  return randomBytes(AUTH_CONFIG.sessionIdBytes).toString("base64url");
}

function toAuthUser(row: typeof users.$inferSelect): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    experienceTier: row.experienceTier,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createAuthService({ db, clock }: AuthServiceDeps) {
  async function createSession(userId: string): Promise<string> {
    const sessionId = newSessionId();
    const now = new Date(clock.now());
    const expiresAt = new Date(now.getTime() + AUTH_CONFIG.sessionLifetimeDays * 24 * 60 * 60 * 1000);
    await db.insert(sessions).values({ id: sessionId, userId, expiresAt, createdAt: now });
    return sessionId;
  }

  async function register(input: RegisterInput): Promise<AuthResult> {
    if (input.password.length < AUTH_CONFIG.minPasswordLength) {
      return { ok: false, reason: `Password must be at least ${AUTH_CONFIG.minPasswordLength} characters.` };
    }
    const email = normalizeEmail(input.email);
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing !== undefined) {
      return { ok: false, reason: "An account with that email already exists." };
    }
    const passwordHash = await hash(input.password);
    const [row] = await db
      .insert(users)
      .values({
        id: newId("user"),
        email,
        passwordHash,
        displayName: input.displayName.trim(),
        createdAt: new Date(clock.now()),
      })
      .returning();
    if (row === undefined) {
      throw new Error("User insert returned no row.");
    }
    const sessionId = await createSession(row.id);
    return { ok: true, user: toAuthUser(row), sessionId };
  }

  async function login(input: LoginInput): Promise<AuthResult> {
    const email = normalizeEmail(input.email);
    const [row] = await db.select().from(users).where(eq(users.email, email));
    if (row === undefined) {
      return { ok: false, reason: GENERIC_LOGIN_FAILURE };
    }
    const valid = await verify(row.passwordHash, input.password);
    if (!valid) {
      return { ok: false, reason: GENERIC_LOGIN_FAILURE };
    }
    const sessionId = await createSession(row.id);
    return { ok: true, user: toAuthUser(row), sessionId };
  }

  async function getUserBySession(sessionId: string): Promise<AuthUser | null> {
    const now = new Date(clock.now());
    const [row] = await db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)));
    return row === undefined ? null : toAuthUser(row.user);
  }

  async function logout(sessionId: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  /** Test-only introspection so tests can assert the plaintext is never persisted. */
  async function debugGetPasswordHash(email: string): Promise<string | null> {
    const [row] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, normalizeEmail(email)));
    return row?.passwordHash ?? null;
  }

  return { register, login, getUserBySession, logout, debugGetPasswordHash };
}

export type AuthService = ReturnType<typeof createAuthService>;
