"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiEnvelope } from "@/lib/api/respond";
import { Button } from "@/components/ui";
import { useLeagueRoomDeps } from "../hooks/deps";
import { formatWeek } from "../lib/format";

interface ScoredBody {
  readonly weekNumber: number;
  readonly matchupsScored: number;
}

/**
 * The commissioner's "run this week" control. Explicit because there is no live feed in this
 * phase — the stat set is fixed, so a week becomes final exactly when somebody says so.
 */
export function ScoreWeekButton({ leagueId, weekNumber }: { readonly leagueId: string; readonly weekNumber: number }) {
  const { fetchJson } = useLeagueRoomDeps();
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const score = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    setStatus(null);
    try {
      const response = await fetchJson(`/api/leagues/${leagueId}/weeks/${weekNumber}/score`, { method: "POST" });
      const body = (await response.json()) as ApiEnvelope<ScoredBody>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      setStatus(`Scored ${body.data.matchupsScored} matchups.`);
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <Button variant="secondary" onClick={() => void score()} loading={submitting} disabled={submitting}>
        {`Score ${formatWeek(weekNumber)}`}
      </Button>
      {status === null ? null : (
        <p role="status" className="text-sm text-positive">
          {status}
        </p>
      )}
      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
