import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { ButtonLink, ErrorState } from "@/components/ui";
import { SCORING_PRESETS } from "@/domain/scoring";
import { LEAGUE_CONFIG } from "@/league";
import { ROSTER_SHAPES } from "@/league/roster-shape";
import { MOCK_CONFIG, MOCK_COPY } from "@/mock-draft/config";
import { createMockRoom } from "@/mock-draft-service/creation";
import { completedMockDebriefs } from "@/mock-draft-service/debrief";
import { listOpenMockRooms, myMockRooms } from "@/mock-draft-service/lobby";
import { createMockRoomSchema } from "@/mock-draft-service/schemas";
import {
  createMockRateLimited,
  mockLifecycleDeps,
} from "@/app/api/mock-drafts/_shared";
import { DraftHeader } from "@/draft-hq/draft-header";
import { MockDraftsPage } from "@/league-room/components/mock-drafts-page";
import type { MockTableOptions } from "@/league-room/lib/mock-table";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { LearningColumn } from "./learning-column";

export const dynamic = "force-dynamic";
// A5: matches this page's own <h1>, which is the Draft area's one heading.
export const metadata: Metadata = pageTitle("Draft");

interface PageProps {
  readonly searchParams: Promise<
    Record<string, string | readonly string[] | undefined>
  >;
}

const RETRY_ACTION = (
  <ButtonLink href="/app/draft/mock-drafts">Back to the lobby</ButtonLink>
);

/**
 * THE MOCK DRAFTS PAGE (the workflow pass, 2026-09-03 — the canvas laws). One verb and a chip
 * sentence (`MockDraftsPage`, law 1), people as a door (law 2), and the learning as the page's
 * second half (`LearningColumn`, law 3) — a caller with no completed mocks gets no column at
 * all, and the doors take the width.
 *
 * `?create=solo` is `DraftRoom`'s own contract with this page (its `MOCK_LOBBY_PATH` docblock):
 * a swept room's restart hands this page that query for an immediate solo room with the schema
 * defaults, honored here once rather than duplicated at every caller. (The page's own DRAFT NOW
 * posts the remembered table client-side — this server path is the default-table fallback.)
 *
 * `MOCK_CONFIG`/`MOCK_COPY` cross into the client component as PLAIN PROPS (ruling 8): the
 * client half lives under `src/league-room/**`, which may not value-import `@/mock-draft` (the
 * client boundary, `eslint.config.mjs`) — this page is where server and client meet.
 */
export default async function MockDraftsLobbyPage({ searchParams }: PageProps) {
  const user = await requireCurrentUser();
  const params = await searchParams;
  const create = params.create;
  const wantsImmediateSolo =
    (typeof create === "string" ? create : create?.[0]) === "solo";

  if (wantsImmediateSolo) {
    const limited = createMockRateLimited(user.id);
    if (limited !== null) {
      const body = (await limited.json()) as { readonly error: string };
      return (
        <>
          <DraftHeader stop="mocks" />
          <ErrorState
            title="Too many mock drafts"
            description={body.error}
            action={RETRY_ACTION}
          />
        </>
      );
    }

    const request = createMockRoomSchema.parse({ mode: "solo" });
    const result = await createMockRoom(
      getDb(),
      { hostUserId: user.id, ...request },
      mockLifecycleDeps(),
    );
    if (result.ok) redirect(`/app/drafts/${result.draftId}`);
    return (
      <>
        <DraftHeader stop="mocks" />
        <ErrorState
          title="We could not start that mock draft"
          description={result.reason}
          action={RETRY_ACTION}
        />
      </>
    );
  }

  const db = getDb();
  const [open, mine, summaries] = await Promise.all([
    listOpenMockRooms(db),
    myMockRooms(db, user.id),
    completedMockDebriefs(db, user.id),
  ]);

  const options: MockTableOptions = {
    teamCounts: MOCK_CONFIG.teamCountOptions,
    pickSeconds: MOCK_CONFIG.pickClockSecondsOptions,
    scoringPresets: Object.keys(SCORING_PRESETS),
    rosterShapes: Object.keys(ROSTER_SHAPES),
    defaultTeamCount: LEAGUE_CONFIG.defaults.teamCount,
    defaultPickSeconds: MOCK_CONFIG.defaultPickClockSeconds,
    defaultScoringPreset: LEAGUE_CONFIG.defaults.scoringPreset,
    defaultRosterShape: LEAGUE_CONFIG.defaults.rosterShape,
    maxTeamNameLength: LEAGUE_CONFIG.maxNameLength,
  };

  return (
    <>
      <DraftHeader stop="mocks" />
      <div
        className={
          summaries.length === 0
            ? "flex flex-col gap-6"
            : "flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start lg:gap-8"
        }
      >
        <MockDraftsPage
          initialOpen={open}
          initialMine={mine}
          options={options}
          copy={{
            soloDetail: MOCK_COPY.soloDetail,
            openLobbyDetail: MOCK_COPY.openLobbyDetail,
            crewDetail: MOCK_COPY.crewDetail,
            sheetTieIn: MOCK_COPY.sheetTieIn,
          }}
        />
        {/* LAW 3's empty state: no completed mocks, no column — absence, not an empty panel. */}
        {summaries.length === 0 ? null : <LearningColumn summaries={summaries} />}
      </div>
      <p className="text-xs text-text-faint">{MOCK_COPY.pageFootnote}</p>
    </>
  );
}
