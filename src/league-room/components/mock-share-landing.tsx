"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { ClaimMockSeatBody } from "@/app/api/mock-drafts/[code]/route";
import type { MockRoomSummary } from "@/mock-draft-service/lobby";
import { Button, Panel, SeatMeter } from "@/components/ui";
import { Countdown, useCountdown } from "@/components/ui/countdown";
import { useLeagueRoomDeps } from "../hooks/deps";

export interface MockShareLandingProps {
  readonly code: string;
  readonly summary: MockRoomSummary;
}

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
    <div className="mx-4 mt-3">
      <Panel title="Join this mock draft">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">
            {summary.teamCount} teams · {summary.pickSeconds}s clock
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
            <Button onClick={() => void join()} loading={claiming} disabled={claiming}>
              {summary.alreadySeated ? "Enter this mock draft" : "Join this mock draft"}
            </Button>
          )}
        </div>
      </Panel>
    </div>
  );
}
