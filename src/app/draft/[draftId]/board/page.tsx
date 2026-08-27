import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { TvBoard } from "@/draft-room/components/tv-board";
import { pageTitle } from "@/components/app-shell/page-metadata";

export const dynamic = "force-dynamic";
// A5: honest static title — the room's real name is drawn from a draft record this task does not
// own a read for; "Draft board" is the room's own established name for this route (RoomRail's
// own docblock reference, `src/draft-room/components/room-rail.tsx`).
export const metadata: Metadata = pageTitle("Draft board");

interface PageProps {
  readonly params: Promise<{ readonly draftId: string }>;
}

/**
 * The TV board. Read-only, but NOT public: a signed-in caller here and league membership in the
 * API behind it. A public board would hand a league's roster construction to anyone who guessed
 * the URL.
 *
 * This route lives at `/draft/...`, not `/app/draft/...`, so `src/middleware.ts`'s
 * `PROTECTED_PAGE_PREFIX` does not redirect it. It redirects itself rather than calling
 * `requireCurrentUser()`, whose thrown `Error` has no `error.tsx` anywhere under `src/app` to
 * catch it — an unauthenticated hit rendered Next's built-in 500 (and, in dev, a stack trace of
 * the auth seam), polluting error monitoring for what is a routine "please sign in".
 *
 * The redirect targets our own `/sign-in` route handler, NOT `getSignInUrl()` directly:
 * AuthKit's URL builder writes a PKCE state cookie, and cookie writes are illegal inside a
 * server component — calling it here is itself a 500 (the bug this comment used to describe
 * a fix for). Route handlers may write cookies; pages may only redirect to one.
 */
export default async function DraftBoardPage({ params }: PageProps) {
  const user = await getCurrentUser();
  if (user === null) redirect("/sign-in");
  const { draftId } = await params;
  // Full-bleed, and no page heading of its own: `RoomRail` renders the league name as the
  // page's `<h1>`, which is a better answer to "what am I looking at" than "Draft board" was.
  return (
    <main className="w-full">
      <TvBoard draftId={draftId} />
    </main>
  );
}
