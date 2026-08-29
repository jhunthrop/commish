"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { ClaimMockSeatBody } from "@/app/api/mock-drafts/[code]/route";
import type { MockRoomSummary } from "@/mock-draft-service/lobby";
import type { MockMode } from "@/mock-draft/config";
import { Button, ButtonLink, LowerThird, Panel, SeatMeter, type LowerThirdCell } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { formatCoarseRemaining, formatCountdown, useCountdown } from "@/components/ui/countdown";
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

  // LAW 6: the two facts a forwarded stranger decides on, then the one verb. Both figures are
  // gone the instant the room is drafting — the seats left are stale the moment the board opens
  // and a countdown to a kickoff that already happened is not a fact — so a started room's strip
  // carries the state and the way out instead.
  const cells: LowerThirdCell[] = summary.started
    ? [{ label: "Room", value: "Drafting now" }]
    : [
        {
          label: "Seats",
          value: (
            <>
              {summary.seatsOpen}
              <span className={`${MICRO_LABEL} ml-1.5 align-middle font-sans text-text-faint`}>
                {summary.seatsOpen === 1 ? "seat open" : "open"} of {summary.teamCount}
              </span>
            </>
          ),
        },
      ];
  if (!summary.started && remainingMs !== null) {
    cells.push({ label: "Starts in", value: formatCountdown(remainingMs), clock: true });
  }

  return (
    // E9: no wrapper margins here — the shell's own `<main>` already pads 16px on every side
    // (`app-shell.tsx`), so `mx-4 mt-3` on top of that was a compounding, visible 16px
    // misalignment against the `PageTitle` above. The shell owns the gutter.
    <div className="flex flex-col gap-4">
      <Panel title="You are invited to a mock draft">
        <div className="flex flex-col gap-3">
          {/* E10: the title carries the invitation; this states the promise a forwarded stranger
              has no other way to learn before they act. */}
          <p className="text-sm text-text-muted">{MOCK_SHARE_LANDING_PRACTICE_SENTENCE}</p>
          {/* The two hero figures moved to the strip at the foot (law 6) — they are what the
              decision rests on, and that is where the decision lives now. What stays here is the
              room's shape and the ONE spoken seat sentence (`srOnlySentence`), so the product's
              single seat statement still reaches assistive tech. */}
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
        </div>
      </Panel>
      <div className="-mx-4">
        <LowerThird
          cells={cells}
          live={!summary.started}
          action={
            strangerAfterStart ? (
              // A room that started without you has one honest act left, and it is not this one.
              <ButtonLink href="/app/mock-drafts" variant="secondary" size="lg">
                Start a new one
              </ButtonLink>
            ) : (
              // `verb`, not the ceremonial ink pill: the strip is where the verb lives, and its
              // own place at the end of the strip is what makes it findable without a fill that
              // competes with the page's own primary.
              <Button variant="verb" size="lg" onClick={() => void join()} loading={claiming} disabled={claiming}>
                {summary.alreadySeated ? "Enter this mock draft" : "Join this mock draft"}
              </Button>
            )
          }
        />
        {/* The strip's digits are `aria-hidden` inside the primitive; this is the same time in
            words, coarsely, so it announces on a boundary rather than every tick. */}
        <p className="sr-only" aria-live="polite">
          {summary.started || remainingMs === null ? null : formatCoarseRemaining(remainingMs)}
        </p>
      </div>
    </div>
  );
}
