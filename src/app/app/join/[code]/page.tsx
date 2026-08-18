import { requireCurrentUser } from "@/lib/auth/current-user";
import { JoinForm } from "@/league-room/components/join-form";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly code: string }>;
}

/** The shareable invite link's destination. Signed-out visitors are redirected by middleware. */
export default async function JoinPage({ params }: PageProps) {
  await requireCurrentUser();
  const { code } = await params;
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <h1 className="font-display text-display-md font-bold leading-display text-text-primary">Join a league</h1>
      <JoinForm code={code} />
    </main>
  );
}
