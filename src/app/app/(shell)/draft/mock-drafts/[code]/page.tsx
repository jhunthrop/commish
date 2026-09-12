import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { ButtonLink, ErrorState, PageTitle } from "@/components/ui";
import { mockRoomSummary } from "@/mock-draft-service/lobby";
import { MockShareLanding } from "@/league-room/components/mock-share-landing";
import { pageTitle } from "@/components/app-shell/page-metadata";

export const dynamic = "force-dynamic";
// A5: matches this page's own <h1> (a static "Mock drafts" regardless of share outcome).
export const metadata: Metadata = pageTitle("Mock drafts");

interface PageProps {
  readonly params: Promise<{ readonly code: string }>;
}

/**
 * The share-link landing (Task 9, Step 1's carry): `ShareLinkPanel`'s own predicted path made
 * real (`MockShareInfo.path`, `@/app/api/drafts/[draftId]/route.ts`: `` `/app/draft/mock-drafts/${room.
 * shareCode}` ``). Reads `mockRoomSummary` directly, the identical "call the service, not the
 * route" shape `WalletPage` already keeps for its own read — `GET /api/mock-drafts/[code]`
 * (Task 7) stays the CLIENT read (`MockShareLanding`'s own re-check on an eventual retry), this
 * page's own first-paint read never duplicates that route's rate limiting or logic, it calls the
 * same function underneath it.
 *
 * `mockRoomSummary`'s own no-existence-oracle rule (its docblock) answers a stale or swept code
 * the same way it answers one that never existed — this page renders that ONE honest sentence
 * either way, never a distinguishing 404 versus "gone" page.
 */
export default async function MockDraftLandingPage({ params }: PageProps) {
  const user = await requireCurrentUser();
  const { code } = await params;
  const result = await mockRoomSummary(getDb(), code, user.id);

  if (!result.ok) {
    return (
      <>
        <PageTitle>Mock drafts</PageTitle>
        <ErrorState
          title="We could not find that mock draft"
          description={result.reason}
          action={<ButtonLink href="/app/draft/mock-drafts">Open the mock draft lobby</ButtonLink>}
        />
      </>
    );
  }

  return (
    <>
      <PageTitle>Mock drafts</PageTitle>
      <MockShareLanding code={code} summary={result.summary} />
    </>
  );
}
