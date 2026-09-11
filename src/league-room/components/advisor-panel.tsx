"use client";

import { useState } from "react";
import { ADVISOR_CONFIG } from "@/domain/advisor";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { AdviceBody } from "../contract";
import { Badge, Button, Input, MessageBubble } from "@/components/ui";
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
    /**
     * SIDELINE (whole-branch review, H5). The round moved every surface above this one and left the
     * foot of the same page in the old vocabulary: an all-caps eyebrow over a bare underline field
     * and an outline button, sitting directly beneath 48px Sideline rows.
     *
     * Three things change and nothing else does. The EYEBROW goes, because "Ask about your lineup"
     * on the field already names the panel and a heading that repeats a label is the explainer P7
     * rules out. The FIELD becomes the mock's 40px pill. And the ANSWER becomes a `MessageBubble`
     * from the league's advisor, which is what Sideline says an answer from somebody is: a person
     * said a thing, in the room's own shape, rather than a bordered card with a display-size
     * headline that outweighed the roster above it.
     *
     * The content, the model call and the refusal to act on the advice are untouched. There is
     * still deliberately NO way to apply it from here (`advisor-panel.test.tsx` asserts the
     * absence), which is a legal constraint and not a UX preference.
     */
    <section aria-label="Lineup advisor" className="flex flex-col gap-3">
      {/* ONE ROW (the scan pass, 2026-08-30): the label rides the field and the ask is field and
          verb on a single line. "Ask" rather than "Get advice": one word, the thing you are doing. */}
      <form
        className="flex w-full items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        {/* The width belongs to the FIELD, not to the `<input>` inside it. `Input`'s `className`
            reaches the element, and `FieldShell` wraps it in a column of its own intrinsic width,
            so `flex-1` on the input grew nothing and the placeholder was clipped mid-word at every
            viewport. The shell gets the growth; the input fills it. */}
        <div className="min-w-0 max-w-md flex-1">
          <Input
            className="w-full rounded-pill px-4"
            label="Ask about your lineup"
            placeholder="Who should I flex this week?"
            value={question}
            maxLength={ADVISOR_CONFIG.maxQuestionLength}
            autoComplete="off"
            onChange={(event) => setQuestion(event.target.value)}
          />
        </div>
        <Button variant="verb" type="submit" loading={thinking} disabled={thinking}>
          Ask
        </Button>
      </form>

      {advice === null ? null : (
        <MessageBubble
          author="Your advisor"
          time={advice.degraded ? "our own math" : undefined}
          aside={advice.degraded ? <Badge tone="warning">Offline advice</Badge> : undefined}
        >
          <span className="flex flex-col gap-1.5">
            <span className="font-display text-lg font-bold leading-tight text-text-primary">{advice.headline}</span>
            <span>{advice.reasoning}</span>
            {advice.degraded ? (
              <span className="text-sm text-text-muted">
                The assistant is unavailable right now, so this is our own math on your league&apos;s scoring.
              </span>
            ) : null}
          </span>
        </MessageBubble>
      )}

      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </section>
  );
}
