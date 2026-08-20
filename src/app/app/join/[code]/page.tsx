import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { readPreferences } from "@/identity-service/preferences";
import { PageTitle } from "@/components/ui";
import { JoinForm } from "@/league-room/components/join-form";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly code: string }>;
}

/**
 * The shareable invite link's destination. Signed-out visitors are redirected by middleware.
 *
 * Reads preferences server-side (`readPreferences`, the same seed-on-first-read call the league
 * home page makes) and forwards `helpLevel` into `JoinForm`, so a `guided` caller's `InfoTip`s
 * on the league terms panel open inline from this page's very first render.
 */
export default async function JoinPage({ params }: PageProps) {
  const user = await requireCurrentUser();
  const { code } = await params;
  const preferences = await readPreferences(getDb(), user);
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
      <PageTitle>Join a league</PageTitle>
      <JoinForm code={code} helpLevel={preferences.helpLevel} />
    </main>
  );
}
