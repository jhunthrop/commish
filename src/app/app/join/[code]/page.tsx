import { requireCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
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
      <PageTitle>Join a league</PageTitle>
      <JoinForm code={code} />
    </main>
  );
}
