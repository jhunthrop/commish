import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { createAuthService } from "./auth";

const db = createTestDb();
const FIXED_NOW = new Date("2026-08-17T12:00:00.000Z");
const clock = { now: () => FIXED_NOW.toISOString() };
const auth = createAuthService({ db, clock });

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("register", () => {
  it("creates a user with a hashed password and returns a session", async () => {
    const result = await auth.register({
      email: "jh@example.com",
      password: "correct horse battery staple",
      displayName: "JH",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.email).toBe("jh@example.com");
    expect(result.user.displayName).toBe("JH");
    expect(result.sessionId).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  });

  it("never stores the plaintext password", async () => {
    const result = await auth.register({
      email: "jh@example.com",
      password: "plaintext-secret",
      displayName: "JH",
    });
    expect(result.ok).toBe(true);
    const stored = await auth.debugGetPasswordHash("jh@example.com");
    expect(stored).not.toBeNull();
    expect(stored).not.toContain("plaintext-secret");
    expect(stored?.startsWith("$argon2")).toBe(true);
  });

  it("rejects a duplicate email with a user-facing reason, not a raw DB error", async () => {
    await auth.register({ email: "jh@example.com", password: "password-one", displayName: "A" });
    const second = await auth.register({ email: "JH@example.com", password: "password-two", displayName: "B" });
    expect(second).toEqual({ ok: false, reason: "An account with that email already exists." });
  });

  it("rejects a password shorter than the configured minimum", async () => {
    const result = await auth.register({ email: "jh@example.com", password: "short", displayName: "JH" });
    expect(result).toEqual({ ok: false, reason: "Password must be at least 12 characters." });
  });
});

describe("login", () => {
  it("returns a session for correct credentials, case-insensitive on email", async () => {
    await auth.register({ email: "jh@example.com", password: "correct horse battery staple", displayName: "JH" });
    const result = await auth.login({ email: "JH@Example.com", password: "correct horse battery staple" });
    expect(result.ok).toBe(true);
  });

  it("returns the same generic reason for wrong password and unknown email", async () => {
    await auth.register({ email: "jh@example.com", password: "correct horse battery staple", displayName: "JH" });
    const wrongPassword = await auth.login({ email: "jh@example.com", password: "wrong-password-here" });
    const unknownEmail = await auth.login({ email: "nobody@example.com", password: "whatever-password" });
    expect(wrongPassword).toEqual({ ok: false, reason: "Incorrect email or password." });
    expect(unknownEmail).toEqual(wrongPassword);
  });
});

describe("sessions", () => {
  it("resolves the current user from a valid session id", async () => {
    const reg = await auth.register({ email: "jh@example.com", password: "correct horse battery staple", displayName: "JH" });
    if (!reg.ok) throw new Error("registration failed");
    const user = await auth.getUserBySession(reg.sessionId);
    expect(user?.email).toBe("jh@example.com");
  });

  it("returns null for an unknown session id", async () => {
    expect(await auth.getUserBySession("does-not-exist")).toBeNull();
  });

  it("returns null for an expired session, judged by the injected clock", async () => {
    const reg = await auth.register({ email: "jh@example.com", password: "correct horse battery staple", displayName: "JH" });
    if (!reg.ok) throw new Error("registration failed");
    const later = new Date(FIXED_NOW.getTime() + 31 * 24 * 60 * 60 * 1000);
    const futureAuth = createAuthService({ db, clock: { now: () => later.toISOString() } });
    expect(await futureAuth.getUserBySession(reg.sessionId)).toBeNull();
  });

  it("logout invalidates the session", async () => {
    const reg = await auth.register({ email: "jh@example.com", password: "correct horse battery staple", displayName: "JH" });
    if (!reg.ok) throw new Error("registration failed");
    await auth.logout(reg.sessionId);
    expect(await auth.getUserBySession(reg.sessionId)).toBeNull();
  });
});
