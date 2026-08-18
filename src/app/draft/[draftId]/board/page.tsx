import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { TvBoard } from "@/draft-room/components/tv-board";

export const dynamic = "force-dynamic";

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
 */
export default async function DraftBoardPage({ params }: PageProps) {
  const user = await getCurrentUser();
  if (user === null) redirect(await getSignInUrl());
  const { draftId } = await params;
  // Full-bleed, and no page heading of its own: `RoomRail` renders the league name as the
  // page's `<h1>`, which is a better answer to "what am I looking at" than "Draft board" was.
  return (
    <main className="w-full">
      <TvBoard draftId={draftId} />
    </main>
  );
}
