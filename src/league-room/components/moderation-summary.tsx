"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Skeleton } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { ModerationSummaryView } from "../contract";
import { useLeagueRoomDeps } from "../hooks/deps";

/**
 * The one sentence that says what this window is and what it deliberately is not — Plan D's
 * task 8, verbatim. Everything else on this card is a number or a date; this is the only
 * sentence, on purpose, so the boundary is stated once rather than implied by what's absent.
 */
const MODERATION_SUMMARY_SENTENCE =
  "Commish reviews reports in every league. We keep the details between the people involved and our operators.";

const CONNECTION_FAILED_MESSAGE = "We could not reach the server. Check your connection and try again.";

const DEFAULT_SUMMARY: ModerationSummaryView = { removedMessages: 0, removedReviews: 0, mostRecentAt: null, openQuestions: 0 };

type Status = "loading" | "ready" | "error";

function formatMostRecent(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

export interface ModerationSummaryProps {
  readonly leagueId: string;
}

/**
 * The commissioner's own window onto platform moderation in their league (Plan B's Task 6
 * persona-panel MEDIUM, closed here). Fetches its own data on mount — this is commissioner-only
 * extra information, not part of every member's `LeagueHomeBody` read, the same "own data layer"
 * shape `useTrades`/`TradeInboxLink` already use rather than growing the shared home read for a
 * surface most of a league's members never see. `LeagueHome` renders this ONLY for
 * `home.isCommissioner`, the same gate `InvitePanel` already sits behind.
 *
 * The empty state ("Nothing has needed attention.") is designed first, not last (the brief's own
 * instruction): it is a real state, and on a healthy league it is the only one anybody ever sees.
 */
export function ModerationSummary({ leagueId }: ModerationSummaryProps) {
  const { fetchJson } = useLeagueRoomDeps();
  const [summary, setSummary] = useState<ModerationSummaryView>(DEFAULT_SUMMARY);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setStatus("loading");
    setError(null);
    try {
      const response = await fetchJson(`/api/leagues/${leagueId}/moderation`);
      const envelope = (await response.json()) as ApiEnvelope<ModerationSummaryView>;
      if (!envelope.ok) {
        setStatus("error");
        setError(envelope.error);
        return;
      }
      // Merged onto the default rather than trusted whole — the same "a test double's own
      // envelope may not carry every field" discipline `useTrades`' own `refetch` uses for
      // `EMPTY_PAGE`, so an incomplete fixture renders the healthy state rather than crashing.
      setSummary({ ...DEFAULT_SUMMARY, ...envelope.data });
      setStatus("ready");
    } catch {
      setStatus("error");
      setError(CONNECTION_FAILED_MESSAGE);
    }
  }, [fetchJson, leagueId]);

  useEffect(() => {
    void load();
  }, [load]);

  const nothingToShow = summary.removedMessages === 0 && summary.removedReviews === 0 && summary.openQuestions === 0;

  return (
    <Card as="section" aria-label="Platform moderation in this league">
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-text-muted">Moderation</h2>
        <p className="text-sm text-text-muted">{MODERATION_SUMMARY_SENTENCE}</p>

        {status === "loading" ? <Skeleton lines={2} /> : null}

        {status === "error" ? (
          <div className="flex flex-col gap-2">
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
            <div>
              <Button type="button" variant="secondary" size="sm" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          </div>
        ) : null}

        {status === "ready" ? (
          nothingToShow ? (
            <p className="text-sm text-text-primary">Nothing has needed attention.</p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div className="flex flex-col">
                <dt className="text-text-muted">Messages removed</dt>
                <dd className="font-medium text-text-primary">{summary.removedMessages}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-text-muted">Reviews removed</dt>
                <dd className="font-medium text-text-primary">{summary.removedReviews}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-text-muted">Open questions</dt>
                <dd className="font-medium text-text-primary">{summary.openQuestions}</dd>
              </div>
              {summary.mostRecentAt === null ? null : (
                <div className="flex flex-col">
                  <dt className="text-text-muted">Most recent</dt>
                  <dd className="font-medium text-text-primary">
                    <time dateTime={summary.mostRecentAt}>{formatMostRecent(summary.mostRecentAt)}</time>
                  </dd>
                </div>
              )}
            </dl>
          )
        ) : null}
      </div>
    </Card>
  );
}
