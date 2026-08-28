"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { ClaimMockSeatBody } from "@/app/api/mock-drafts/[code]/route";
import type { MockRoomSummary } from "@/mock-draft-service/lobby";
import type { MockMode } from "@/mock-draft/config";
import { Button, Panel, SeatMeter } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
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
        {/* GAMEDAY, LAW 2: the two facts a forwarded stranger actually decides on — how many
            seats are still going, and how long is left — are the page's largest things now. They
            were a 13px clause and a 13px clock inside a 400px column, which is the flat hierarchy
            the spec measured and rejected. `SeatMeter` keeps the spoken sentence
            (`srOnlySentence`) so the product's one seat statement still reaches assistive tech
            while the screen shows the figure. */}
        {summary.started ? null : (
          // Both figures answer "should I take this seat", and neither is that question any more
          // once the room is drafting: the seats left are stale the instant the board opens, and
          // a countdown to a kickoff that already happened is not a fact. A started room says its
          // one true thing through the action below instead.
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
            <div className="flex shrink-0 items-baseline gap-2">
              <span data-testid="share-seats-open" className="font-mono text-display-lg font-semibold tabular-nums leading-display text-text-primary">
                {summary.seatsOpen}
              </span>
              <span className={`${MICRO_LABEL} text-text-faint`}>{summary.seatsOpen === 1 ? "seat open" : "seats open"}</span>
            </div>
            {remainingMs === null ? null : (
              <div className="flex shrink-0 flex-col">
                {/* The same step as the seat figure beside it: the two facts a stranger weighs
                    against each other are weighed at the same size, or the layout has made the
                    choice for them. */}
                <Countdown remainingMs={remainingMs} size="lg" />
                <span className={`${MICRO_LABEL} text-text-faint`}>until kickoff</span>
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <SeatMeter filled={summary.teamCount - summary.seatsOpen} total={summary.teamCount} srOnlySentence />
          <span className="font-mono text-xs tabular-nums text-text-muted">
            {MODE_LABEL[summary.mode]} · {summary.teamCount} teams · {summary.pickSeconds}s clock
          </span>
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
          // `primary` and full width nowhere: this IS the one ceremonial act the page exists to
          // perform (law 5's own definition), but a 1500px-wide ink pill is a button that has
          // stopped looking like a button. `self-start` gives it its own measure.
          <Button className="self-start" onClick={() => void join()} loading={claiming} disabled={claiming}>
            {summary.alreadySeated ? "Enter this mock draft" : "Join this mock draft"}
          </Button>
        )}
      </div>
    </Panel>
  );
}
