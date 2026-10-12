import { getDb } from "@research/db/client";
import { fail, ok } from "@/lib/api/respond";
import { invitePreview } from "@/league-service";
import type { InvitePreviewBody } from "@/league-room/contract";
import { previewRateLimited } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  readonly params: Promise<{ readonly code: string }>;
}

/**
 * What an invite link is agreeing to, before the account-holding step of accepting it.
 * Unauthenticated on purpose, like `GET /api/public/leagues`: the code itself is the
 * capability (exactly as `acceptInvite` already treats it), and a prospect deciding whether to
 * join has to be able to see what they are joining before creating an account, not after.
 *
 * `invitePreview` (`@/league-service/invites`) is what keeps this safe, not this handler — a
 * bad or expired code answers the plain-language refusal and NOTHING else, so this route can
 * never be used to enumerate a private league's name by guessing codes. See its own docblock.
 *
 * Rate-limited by IP (`previewRateLimited`, `./_shared.ts`) before the query ever runs, same
 * discipline as the browse route it mirrors.
 */
export async function GET(request: Request, { params }: RouteContext) {
  const limited = previewRateLimited(request);
  if (limited !== null) return limited;

  const { code } = await params;
  try {
    const result = await invitePreview(getDb(), code);
    if (!result.ok) return fail(result.reason, 404);
    return ok<InvitePreviewBody>(result.terms);
  } catch (error: unknown) {
    console.error("[invites] preview route handler failed", { path: new URL(request.url).pathname }, error);
    return fail("Something went wrong on our side. Please try again.", 500);
  }
}
