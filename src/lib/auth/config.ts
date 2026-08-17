export const AUTH_CONFIG = {
  /** Minimum password length. NIST SP 800-63B recommends 8+; 12 is the chosen bar for a real-money product. */
  minPasswordLength: 12,
  /** Session lifetime in days; the expiry is enforced by comparing against the injected clock, never Date.now(). */
  sessionLifetimeDays: 30,
  /** Bytes of entropy in a session id before base64url encoding. */
  sessionIdBytes: 32,
  sessionCookieName: "commish_session",
} as const;
