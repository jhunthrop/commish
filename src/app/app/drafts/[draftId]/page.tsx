import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { readPreferences } from "@/identity-service/preferences";
import { ToastProvider } from "@/components/ui";
import { DraftRoom } from "@/draft-room/components/draft-room";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly draftId: string }>;
}

/**
 * The authed shell. Membership is enforced by the API the room calls — a non-member gets a
 * 403 that surfaces as the room's error state. The rule lives in `resolveDraftActor`, once.
 *
 * Deliberately NOT the centered `max-w-*` container every other app page uses: a draft room is
 * a room, not a document. It takes the whole viewport, owns its own scrolling, and supplies
 * its own `<h1>` (the league name, in `RoomRail`) — so there is no page heading here to say
 * "Draft room" above a board that already says which draft this is.
 *
 * Reads preferences server-side (`readPreferences`, which seeds the row on a caller's first
 * read anywhere in the product) so `DraftRoom` knows on its very first render whether to show
 * `RoomTour` — no client-side fetch sits on the room's critical path just to answer that. The
 * same read's `helpLevel` is forwarded too, so `RoomRail`'s `InfoTip`s open guided for a
 * `guided` caller from the room's very first render, not just `RoomTour`.
 */
export default async function DraftRoomPage({ params }: PageProps) {
  const user = await requireCurrentUser();
  const { draftId } = await params;
  const preferences = await readPreferences(getDb(), user);
  return (
    <ToastProvider>
      <main className="w-full">
        <DraftRoom draftId={draftId} dismissedAt={preferences.draftTourDismissedAt} helpLevel={preferences.helpLevel} />
      </main>
    </ToastProvider>
  );
}
