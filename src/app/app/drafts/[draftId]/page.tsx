import { requireCurrentUser } from "@/lib/auth/current-user";
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
 */
export default async function DraftRoomPage({ params }: PageProps) {
  await requireCurrentUser();
  const { draftId } = await params;
  return (
    <ToastProvider>
      <main className="w-full">
        <DraftRoom draftId={draftId} />
      </main>
    </ToastProvider>
  );
}
