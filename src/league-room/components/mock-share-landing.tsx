"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { ClaimMockSeatBody } from "@/app/api/mock-drafts/[code]/route";
import type { MockRoomSummary } from "@/mock-draft-service/lobby";
import type { MockMode } from "@/mock-draft/config";
import { Button, Panel, SeatMeter } from "@/components/ui";
import { Countdown, useCountdown } from "@/components/ui/countdown";
import { useLeagueRoomDeps } from "../hooks/deps";

export interface MockShareLandingProps {
  readonly code: string;
  readonly summary: MockRoomSummary;
}

/** Short mode words for this landing's meta line — this component's own, not `MockSetupForm`'s
 *  longer descriptive labels ("Solo, play against bots"): the create form is asking a question,
 *  this landing is stating a fact in passing. `src/league-room/**` may not value-import
 *  `@/mock-draft` (the client boundary), so the words are typed fresh here the same way
 *  `MockSetupForm`'s own `MODE_LABEL` already is. */
const MODE_LABEL: Readonly<Record<MockMode, string>> = {
  solo: "Solo practice",
  lobby: "Open lobby",
  link: "Private link",
};

/**
 * E10 (lobby review, 2026-08-26): the one practice-promise sentence this landing owes a
 * forwarded stranger, who has committed to nothing yet and has no way to know this is not a
 * real league. Kept as a LOCAL exported constant rather than a new `MOCK_COPY` entry: `E12`'s
 * fix (the mock lobby's own empty-history sentence, `mock-lobby.tsx`) is landing a different new
 * `MOCK_COPY` key in this same fix pass, and two implementers adding two keys to one object in
 * the same window is exactly the collision this sidesteps. Deferred, not skipped — this belongs
 * beside `MOCK_COPY.practiceBanner` once both land, threaded as a prop the same way
 * `MOCK_COPY.lobbyEmptyMessage` already reaches `MockLobby` (ruling 8). It passes `copyViolations`
 * (`@/integrity/copy-rules`) today the same as it would sitting in that object already: no dash,
 * no contraction, no accusatory or passive construction, nothing from the forbidden vocabulary.
 */
export const MOCK_SHARE_LANDING_PRACTICE_SENTENCE = "This mock draft is practice. Nothing here counts, and it costs nothing to join.";

/**
 * The share-link landing (Task 9, Step 1's other carry): `ShareLinkPanel`'s own predicted path,
 * `/app/mock-drafts/${shareCode}` (`@/app/api/drafts/[draftId]/route.ts`), made real. A signed-in
 * caller only (the founder's sign-in-first ruling — every mock route already requires one), so
 * this never needs its own anonymous preview.
 *
 * The join button ALWAYS attempts the claim, whether or not the summary already looks joinable —
 * the same "let the write be the truth" discipline `claimMockSeat`'s own re-entry rule already
 * holds: a stranger who arrives after the room fills or starts gets the server's own honest
 * refusal rendered here, never a client-guessed disabled state that could drift from what the
 * claim door actually decides moment to moment.
 */
export function MockShareLanding({ code, summary }: MockShareLandingProps) {
  const router = useRouter();
  const { fetchJson } = useLeagueRoomDeps();
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Computed once, from the request-time `startsInMs` the server read (ruling 10) — the same
  // "a relative duration becomes an absolute deadline the moment the client has it" shape this
  // surface's own countdown needs, `useCountdown` itself only ever takes an ISO instant.
  const [startsAt] = useState(() => new Date(Date.now() + summary.startsInMs).toISOString());
  const { remainingMs } = useCountdown(startsAt);

  const join = async (): Promise<void> => {
    setClaiming(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/mock-drafts/${code}`, { method: "POST" });
      const body = (await response.json()) as ApiEnvelope<ClaimMockSeatBody>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      router.push(`/app/drafts/${body.data.draftId}`);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setClaiming(false);
    }
  };

  const strangerAfterStart = summary.started && !summary.alreadySeated;

  return (
    // E9: no wrapper margins here — the shell's own `<main>` already pads 16px on every side
    // (`app-shell.tsx`), so `mx-4 mt-3` on top of that was a compounding, visible 16px
    // misalignment against the `PageTitle` above. The shell owns the gutter.
    <Panel title="You are invited to a mock draft">
      <div className="flex flex-col gap-3">
        {/* E10: the title now carries the invitation; this states the promise a forwarded
            stranger has no other way to learn before they act. */}
        <p className="text-sm text-text-muted">{MOCK_SHARE_LANDING_PRACTICE_SENTENCE}</p>
        <p className="text-sm text-text-muted">
          {MODE_LABEL[summary.mode]} · {summary.teamCount} teams · {summary.pickSeconds}s clock
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <SeatMeter filled={summary.teamCount - summary.seatsOpen} total={summary.teamCount} />
          {summary.started || remainingMs === null ? null : <Countdown remainingMs={remainingMs} size="sm" />}
        </div>
        {error === null ? null : (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}
        {strangerAfterStart ? (
          <p className="text-sm text-text-muted">
            This mock draft has already started.{" "}
            <Link href="/app/mock-drafts" className="font-medium text-accent underline">
              Start a new one
            </Link>
            .
          </p>
        ) : (
          // The button STAYS the act — the invitation now lives in the Panel's own title.
          <Button onClick={() => void join()} loading={claiming} disabled={claiming}>
            {summary.alreadySeated ? "Enter this mock draft" : "Join this mock draft"}
          </Button>
        )}
      </div>
    </Panel>
  );
}
