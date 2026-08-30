"use client";

import { useState } from "react";
import { ADVISOR_CONFIG } from "@/domain/advisor";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { AdviceBody } from "../contract";
import { Badge, Button, Card, EYEBROW, Input } from "@/components/ui";
import { useLeagueRoomDeps } from "../hooks/deps";

/**
 * The advisor a manager actually talks to. It knows the roster, this league's exact scoring and
 * this week's opponent already — no sync step, no pasted screenshot — which is the whole point
 * (strategy doc §4.2).
 *
 * **There is deliberately no way to apply the advice from here.** No "set my lineup" button, no
 * one-tap accept: the advisor recommends and a human acts, which is a legal constraint rather
 * than a UX preference, and `advisor-panel.test.tsx` asserts the absence so nobody adds one by
 * reflex.
 */
export function AdvisorPanel({ leagueId, weekNumber }: { readonly leagueId: string; readonly weekNumber: number }) {
  const { fetchJson } = useLeagueRoomDeps();
  const [question, setQuestion] = useState("");
  const [advice, setAdvice] = useState<AdviceBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);

  const ask = async (): Promise<void> => {
    const trimmed = question.trim();
    if (trimmed.length === 0) return;
    setThinking(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/leagues/${leagueId}/advisor/start-sit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekNumber, question: trimmed }),
      });
      const body = (await response.json()) as ApiEnvelope<AdviceBody>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      setAdvice(body.data);
    } catch {
      setError("We could not reach the advisor. Check your connection and try again.");
    } finally {
      setThinking(false);
    }
  };

  return (
    <section aria-label="Lineup advisor" className="flex flex-col gap-2">
      <h2 className={`${EYEBROW} text-text-muted`}>Lineup advisor</h2>

      {/* ONE ROW (the scan pass, 2026-08-30): a heading, an aside, a labelled field and a
          right-floated button was four eye stops for one act. The label rides the field, the
          aside died — "Advice only. You make the move." was a disclaimer the quiet button
          already implies — and the ask is input-and-button on a single line. */}
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <Input
          className="max-w-md flex-1"
          label="Ask about your lineup"
          placeholder="Who should I flex this week?"
          value={question}
          maxLength={ADVISOR_CONFIG.maxQuestionLength}
          autoComplete="off"
          onChange={(event) => setQuestion(event.target.value)}
        />
        <Button variant="secondary" type="submit" loading={thinking} disabled={thinking}>
          Get advice
        </Button>
      </form>

      {advice === null ? null : (
        <Card>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-display text-display-sm font-semibold leading-display text-text-primary">{advice.headline}</p>
              {advice.degraded ? <Badge tone="warning">Offline advice</Badge> : null}
            </div>
            <p className="text-text-primary">{advice.reasoning}</p>
            {advice.degraded ? (
              <p className="text-sm text-text-muted">
                The assistant is unavailable right now, so this is our own math on your league&apos;s scoring.
              </p>
            ) : null}
          </div>
        </Card>
      )}

      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </section>
  );
}
