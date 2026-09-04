/**
 * Flow analysis C-01: the value a person actually shares has to be a URL that opens, not a
 * relative path — a bare `/app/join/ABC123` pasted into a text message opens nothing. Read off
 * THIS request's own origin, never assumed from a browser this server never sees: Next.js
 * rewrites `request.url` to carry the incoming `Host` header, the same origin a browser hitting
 * the route would have used to reach it, in dev and behind a proxy alike.
 *
 * `NEXT_PUBLIC_APP_URL` is the documented, honest fallback (`.env.example`) for the one case a
 * request has no parseable URL at all — never true in production, since every request a route
 * handler runs inside already has one; kept so a malformed edge case degrades to a configured
 * value instead of a thrown exception.
 *
 * Extracted from `POST /api/leagues/[leagueId]/invites` (link audit, 2026-09-04) the moment a
 * second minting route — the mock room's share link — needed the identical origin: one source
 * of truth for how a shareable URL learns its host.
 */
export function originFor(request: Request): string {
  try {
    return new URL(request.url).origin;
  } catch {
    return process.env.NEXT_PUBLIC_APP_URL ?? "";
  }
}
