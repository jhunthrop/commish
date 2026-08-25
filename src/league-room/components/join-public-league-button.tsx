"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { JoinBody } from "../contract";
import { Button } from "@/components/ui";
import { useLeagueRoomDeps } from "../hooks/deps";

/**
 * The one interactive thing on a public page. Built exactly like `JoinForm`: the injected
 * `fetchJson` seam, the envelope, the server's own plain-language refusal shown in place.
 *
 * A refusal is shown here rather than thrown away because the reasons are all real and all
 * recoverable from this page: the league filled, or its draft started, between the render and
 * the press. The visitor stays on the list and can pick another league.
 */
export function JoinPublicLeagueButton({
  leagueId,
  leagueName,
  variant = "secondary",
}: {
  readonly leagueId: string;
  readonly leagueName: string;
  /** Rule 5: quiet pill unless the PARENT grants this card the view's one ink action —
   *  `OpenLeagueCard` maps its own `emphasis` prop here, and Task 6 decides which card gets it. */
  readonly variant?: "primary" | "secondary";
}) {
  const { fetchJson } = useLeagueRoomDeps();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const join = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/public/leagues/${leagueId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await response.json()) as ApiEnvelope<JoinBody>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      router.push(`/app/leagues/${body.data.leagueId}`);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <Button variant={variant} onClick={() => void join()} loading={submitting} disabled={submitting} aria-label={`Join ${leagueName}`}>
        Join
      </Button>
      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
