/**
 * Flow analysis C-01: the value a person actually shares has to be a URL that opens, not a
 * relative path — a bare `/app/join/ABC123` pasted into a text message opens nothing.
 *
 * TRUST ORDER (review finding, 2026-09-04): a minted, copyable link must never learn its host
 * from the request, because `request.url`'s origin is the client's own `Host` header — an
 * attacker-influenced value that would ride into a URL a commissioner pastes as canonical
 * (and even benignly, a preview deployment's own hostname would mint itself into links shared
 * as the product's). The origin therefore comes from CONFIGURATION first:
 *   1. `NEXT_PUBLIC_APP_URL` (the documented canonical origin, `.env.example`);
 *   2. `VERCEL_PROJECT_PRODUCTION_URL` (Vercel's own system value, a bare host);
 *   3. only then the request itself — the local-dev case, where the developer IS the client.
 *
 * Extracted from `POST /api/leagues/[leagueId]/invites` (link audit, 2026-09-04) the moment a
 * second minting route — the mock room's share link — needed the identical origin: one source
 * of truth for how a shareable URL learns its host.
 */
export function originFor(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured !== undefined && configured.length > 0) return new URL(configured).origin;
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelHost !== undefined && vercelHost.length > 0) return `https://${vercelHost}`;
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}
