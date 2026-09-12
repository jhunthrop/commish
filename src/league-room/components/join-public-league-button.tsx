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
  label = "Join",
  accessibleName,
}: {
  readonly leagueId: string;
  readonly leagueName: string;
  /** Rule 5: quiet pill unless the PARENT grants this card the view's one ink action —
   *  `OpenLeagueCard` maps its own `emphasis` prop here, and Task 6 decides which card gets it. */
  readonly variant?: "primary" | "secondary" | "verb";
  /**
   * The visible words (2026-09-11). `ctaVisibleText` (`./open-league-shared`) has always owned
   * this row's verb for a signed-OUT visitor ("Take a seat", "Take the last seat") while this
   * button said "Join", so one row said two different things depending on who was reading it.
   * `OpenLeagueCta` passes the same sentence for both states now. The default keeps any caller
   * that builds this button directly working unchanged.
   */
  readonly label?: string;
  /** The spoken sentence. `OpenLeagueCta` passes `ctaAccessibleName(league)`, the SAME sentence
   *  the signed-out link announces, so the two auth states of one row read identically to a
   *  screen reader as well as to an eye. */
  readonly accessibleName?: string;
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
      <Button variant={variant} onClick={() => void join()} loading={submitting} disabled={submitting} aria-label={accessibleName ?? `Join ${leagueName}`}>
        {label}
      </Button>
      {error === null ? null : (
        /* `max-w-56` (Task 12, persona checkpoint): inside `LeagueRow`'s `max-content` action
           column an unmeasured paragraph sizes the track to the whole sentence unwrapped and
           crushes the row's other five columns — the cap wraps the refusal inside its own
           column. In a card the surrounding width already governs, so nothing changes there. */
        <p role="alert" className="max-w-56 text-sm text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
