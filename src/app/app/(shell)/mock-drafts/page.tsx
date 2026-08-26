import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { ButtonLink, ErrorState, PageTitle } from "@/components/ui";
import { LEAGUE_CONFIG } from "@/league";
import { MOCK_CONFIG, MOCK_COPY } from "@/mock-draft/config";
import { createMockRoom } from "@/mock-draft-service/creation";
import { listOpenMockRooms, myMockRooms } from "@/mock-draft-service/lobby";
import { createMockRoomSchema } from "@/mock-draft-service/schemas";
import { createMockRateLimited, mockLifecycleDeps } from "@/app/api/mock-drafts/_shared";
import { MockLobby } from "@/league-room/components/mock-lobby";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly searchParams: Promise<Record<string, string | readonly string[] | undefined>>;
}

const RETRY_ACTION = <ButtonLink href="/app/mock-drafts">Back to the lobby</ButtonLink>;

/**
 * The practice lobby (Task 9, Step 2) — the setup form, the open lobby a stranger can join, and
 * the caller's own rooms, ALL in `(shell)` (signed-in only, the founder's sign-in-first ruling —
 * no anonymous rooms). `?create=solo` is `DraftRoom`'s own contract with this page (its own
 * `MOCK_LOBBY_PATH` docblock, `@/draft-room/components/draft-room.tsx`, and `MockLobby`'s own
 * empty-lobby action): "Run it again" and a swept-room's own restart both hand this page that
 * query, asking for an immediate solo room rather than the form. Honored here, once, rather than
 * duplicated at every caller that wants a solo room in one click — `createMockRoom` is exactly
 * the same call `POST /api/mock-drafts` makes, run server-side so the click is one navigation,
 * not a navigation plus a fetch.
 *
 * `MOCK_CONFIG`/`MOCK_COPY` cross into `MockLobby`/`MockSetupForm` as PLAIN PROPS (ruling 8):
 * both client components live under `src/league-room/**`, which may not value-import
 * `@/mock-draft` (the client boundary, `eslint.config.mjs`) — this page is the one place server
 * and client meet, so it reads the real config once and hands down only the values those two
 * components actually render.
 */
export default async function MockDraftsPage({ searchParams }: PageProps) {
  const user = await requireCurrentUser();
  const params = await searchParams;
  const create = params.create;
  const wantsImmediateSolo = (typeof create === "string" ? create : create?.[0]) === "solo";

  if (wantsImmediateSolo) {
    const limited = createMockRateLimited(user.id);
    if (limited !== null) {
      const body = (await limited.json()) as { readonly error: string };
      return (
        <>
          <PageTitle>Practice drafts</PageTitle>
          <ErrorState title="Too many practice drafts" description={body.error} action={RETRY_ACTION} />
        </>
      );
    }

    const request = createMockRoomSchema.parse({ mode: "solo" });
    const result = await createMockRoom(getDb(), { hostUserId: user.id, ...request }, mockLifecycleDeps());
    if (result.ok) redirect(`/app/drafts/${result.draftId}`);
    return (
      <>
        <PageTitle>Practice drafts</PageTitle>
        <ErrorState title="We could not start that practice draft" description={result.reason} action={RETRY_ACTION} />
      </>
    );
  }

  const db = getDb();
  const [open, mine] = await Promise.all([listOpenMockRooms(db), myMockRooms(db, user.id)]);

  return (
    <>
      <PageTitle>Practice drafts</PageTitle>
      <MockLobby
        initialOpen={open}
        initialMine={mine}
        modes={MOCK_CONFIG.modes}
        teamCountOptions={MOCK_CONFIG.teamCountOptions}
        pickSecondsOptions={MOCK_CONFIG.pickClockSecondsOptions}
        defaultTeamCount={LEAGUE_CONFIG.defaults.teamCount}
        defaultPickSeconds={MOCK_CONFIG.defaultPickClockSeconds}
        emptyMessage={MOCK_COPY.lobbyEmptyMessage}
        emptyActionLabel={MOCK_COPY.lobbyEmptyActionLabel}
      />
    </>
  );
}
