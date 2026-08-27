import { getDb } from "@/db/client";
import { fail, ok, parseJson } from "@/lib/api/respond";
import { createInvite, createInviteSchema, listInvites, revokeInvite, revokeInviteSchema } from "@/league-service";
import type { InviteBody, InviteListBody } from "@/league-room/contract";
import { withCommissioner, type LeagueRouteContext } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const systemClock = { now: () => new Date().toISOString() };

// Invite codes are membership capabilities, so their randomness must be unpredictable.
// Math.random is seedable/observable; this derives a [0,1) float from crypto instead.
function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 2 ** 32;
}

/**
 * Flow analysis C-01: the value a commissioner actually shares has to be a URL that opens, not
 * `InviteBody.path` alone — a relative path pasted into a text message does nothing. Read off
 * THIS request's own origin, never assumed from a browser this server never sees: Next.js
 * rewrites `request.url` to carry the incoming `Host` header, the same origin a browser hitting
 * this route would have used to reach it, in dev and behind a proxy alike.
 *
 * `NEXT_PUBLIC_APP_URL` is the documented, honest fallback (`.env.example`) for the one case a
 * request has no parseable URL at all — never true in production, since every request this
 * route handler runs inside already has one; kept so a malformed edge case degrades to a
 * configured value instead of a thrown exception.
 */
function originFor(request: Request): string {
  try {
    return new URL(request.url).origin;
  } catch {
    return process.env.NEXT_PUBLIC_APP_URL ?? "";
  }
}

function inviteBodyFor(origin: string, invite: { readonly code: string; readonly expiresAt: string; readonly maxUses: number; readonly uses: number }): InviteBody {
  const path = `/app/join/${invite.code}`;
  return { code: invite.code, path, url: `${origin}${path}`, expiresAt: invite.expiresAt, maxUses: invite.maxUses, uses: invite.uses };
}

/**
 * Commissioner-only: mint a shareable link + short code for this league. Minting is deliberately
 * left un-gated here on whether a live invite already exists — `InvitePanel` (flow analysis
 * C-03) is what decides whether to offer this button at all, showing the existing live invite
 * instead once one is found, so "create another" only ever happens on a deliberate second press,
 * never a reload's silent duplicate.
 */
export async function POST(request: Request, context: LeagueRouteContext) {
  return withCommissioner(request, context, async (actor, req) => {
    const parsed = await parseJson(req, createInviteSchema);
    if (!parsed.ok) return parsed.response;

    const result = await createInvite(
      { db: getDb(), clock: systemClock, random: cryptoRandom },
      { leagueId: actor.leagueId, createdByUserId: actor.userId, maxUses: parsed.value.maxUses },
    );
    if (!result.ok) return fail(result.reason, 503);
    return ok<InviteBody>(inviteBodyFor(originFor(req), { code: result.code, expiresAt: result.expiresAt, maxUses: result.maxUses, uses: 0 }));
  });
}

/**
 * Commissioner-only: every LIVE invite this league holds right now (flow analysis C-03) — what
 * `InvitePanel` reads on load so a reload shows the code already sent, instead of offering
 * "Create invite link" again over a code that still works.
 */
export async function GET(request: Request, context: LeagueRouteContext) {
  return withCommissioner(request, context, async (actor, req) => {
    const invites = await listInvites(getDb(), actor.leagueId, systemClock);
    const origin = originFor(req);
    return ok<InviteListBody>({ invites: invites.map((invite) => inviteBodyFor(origin, invite)) });
  });
}

/**
 * Commissioner-only: kill a live code (flow analysis C-03). Same authority gate as POST/GET —
 * `withCommissioner` — and scoped to this league in the service layer too (`revokeInvite`'s own
 * WHERE), so a commissioner can never revoke a code that belongs to a different league.
 */
export async function DELETE(request: Request, context: LeagueRouteContext) {
  return withCommissioner(request, context, async (actor, req) => {
    const parsed = await parseJson(req, revokeInviteSchema);
    if (!parsed.ok) return parsed.response;

    const result = await revokeInvite({ db: getDb(), clock: systemClock }, { leagueId: actor.leagueId, code: parsed.value.code });
    if (!result.ok) return fail(result.reason, result.status);
    return ok<{ readonly code: string }>({ code: parsed.value.code });
  });
}
