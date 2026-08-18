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
 */
export default async function DraftRoomPage({ params }: PageProps) {
  await requireCurrentUser();
  const { draftId } = await params;
  return (
    <ToastProvider>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4">
        <h1 className="text-2xl font-semibold text-text-primary">Draft room</h1>
        <DraftRoom draftId={draftId} />
      </main>
    </ToastProvider>
  );
}
