import { requireCurrentUser } from "@/lib/auth/current-user";
import { TvBoard } from "@/draft-room/components/tv-board";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly draftId: string }>;
}

/**
 * The TV board. Read-only, but NOT public: `requireCurrentUser()` here and league membership
 * in the API behind it. A public board would hand a league's roster construction to anyone
 * who guessed the URL.
 *
 * Note this route lives at `/draft/...`, not `/app/draft/...`, so `src/middleware.ts` does not
 * redirect it — an unauthenticated viewer gets `requireCurrentUser()`'s thrown error page
 * rather than a silent hop to hosted sign-in. That is the same behavior every other non-`/app`
 * page has; if a redirect is wanted later, the prefix in `src/middleware.ts` is the one knob.
 */
export default async function DraftBoardPage({ params }: PageProps) {
  await requireCurrentUser();
  const { draftId } = await params;
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
      <TvBoard draftId={draftId} />
    </main>
  );
}
