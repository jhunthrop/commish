"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { chatRemovalPhraseFor, removalPhraseFor } from "@/moderation/removal";
import { Button, Textarea } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { ResolutionDecision } from "@/integrity/flags";
import { REVIEW_CONFIG } from "@/reviews/config";
import { useAdminRoomDeps } from "../hooks/deps";

const DECISION_LABEL: Readonly<Record<ResolutionDecision, string>> = {
  no_action: "No action",
  warned_user: "Warn the member",
  content_removed: "Remove the content",
  trade_reversed: "Reverse the trade",
};

/** The static half of the notice a decision sends — title and body never change with the note
 *  the operator is typing, so the page computes this once (`renderNotice`, `@/integrity/
 *  notices`) and hands it down as data. `undefined` means the decision notices nobody. */
export interface DecisionPreview {
  readonly title: string;
  readonly body: string;
}

export interface ResolutionFormProps {
  readonly flagId: string;
  /** Already narrowed to what this product can carry out AND what this subject's own removal
   *  path supports — the page's own decision, not this form's. */
  readonly decisions: readonly ResolutionDecision[];
  /** `INTEGRITY_CONFIG.moderation.noteMaxLength` (500) — every decision's cap EXCEPT
   *  `content_removed`'s (`maxLengthFor`, below). Passed as a prop, never imported directly:
   *  `@/integrity` is blocked for room code (the client boundary, `eslint.config.mjs`), so the
   *  page (which CAN import it) hands the number down as plain data — the same "cross the
   *  boundary via props, not via import" shape `previews` already uses. */
  readonly noteMaxLength: number;
  readonly previews: Readonly<Partial<Record<ResolutionDecision, DecisionPreview>>>;
  /**
   * Fix round 1: which mapper `ContentRemovedPreview` runs the operator's note through — `chat_
   * message_removed` and `review_removed` fall back to two DIFFERENT generic phrases ("breaking
   * the chat rules" vs "breaking the review rules"), so previewing the wrong one would show the
   * operator words the member will never actually read. A plain boolean, not the subject's own
   * type, because a function prop cannot cross the Server-to-Client boundary this form is handed
   * across (`@/integrity`'s `FlagSubjectView` stays a page-only import).
   */
  readonly isChatSubject: boolean;
}

/**
 * The note's real cap for the CHOSEN decision — fix round 1, FIX 4: the counter used to always
 * show `noteMaxLength` (500) regardless of which decision was selected, so an operator writing a
 * 300-character `content_removed` note saw "200 characters left" nowhere and then hit a 400 on
 * submit that the form gave no warning about. `resolveFlag`'s own tighter check
 * (`src/integrity-service/flags.ts`) reads `REVIEW_CONFIG.removalReason.maxLength` for exactly
 * this decision, for exactly this reason (a `content_removed` note becomes `removeReviewInTx`'s
 * removal REASON, not an `operator_warning` notice body) — importing the SAME constant here,
 * rather than a second `200` this file would own, is what keeps the counter and the server cap
 * from ever being able to disagree again. `@/reviews` is the browser-safe half of that pair
 * (unlike `@/review-service`, which is blocked), so this is a direct, legal import, not a prop.
 */
function maxLengthFor(decision: ResolutionDecision | null, noteMaxLength: number): number {
  return decision === "content_removed" ? REVIEW_CONFIG.removalReason.maxLength : noteMaxLength;
}

/**
 * The state a member reads if this decision is `no_action` — ruling 6, stated plainly rather
 * than left to the operator to infer from an absent preview panel.
 */
function NoActionPreview() {
  return (
    <p className="text-sm text-text-muted">
      The member will not be told. This decision is recorded here, and nothing is sent. A member reviewed and cleared never learns they were looked at.
    </p>
  );
}

/**
 * The exact words a `content_removed` decision sends. `removalPhraseFor`/`chatRemovalPhraseFor`
 * (`@/moderation/removal`) are the same two mappers `notify.ts`'s own `quoteFor` runs the stored
 * reason through at render, picked by `isChatSubject` — an operator's own free-text note is NOT
 * one of the three platform-authored tokens either mapper recognizes, so it falls back to the
 * generic phrase every time, and the two domains' generic phrases differ (fix round 1). Shown
 * here rather than hidden, because an operator who thinks their words are about to be quoted
 * verbatim is about to be surprised by the real notice, and this is the moment to say so.
 */
function ContentRemovedPreview({ preview, note, isChatSubject }: { readonly preview: DecisionPreview; readonly note: string; readonly isChatSubject: boolean }) {
  const reason = note.length === 0 ? null : note;
  const phrase = isChatSubject ? chatRemovalPhraseFor(reason) : removalPhraseFor(reason);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-text-primary">{preview.title}</p>
      <p className="text-sm text-text-muted">{preview.body}</p>
      <blockquote className="border-l-2 border-border pl-3 text-sm italic text-text-muted">{`"${phrase}"`}</blockquote>
      <p className="text-xs text-text-muted">We keep your note on file for this decision. The member reads this general reason, not your words.</p>
    </div>
  );
}

/** The exact words a `warned_user` decision sends — the note reaches the member VERBATIM
 *  (`notify.ts`'s `quoteFor`), so the live blockquote below is the real thing, not an
 *  approximation. */
function WarnedUserPreview({ preview, note }: { readonly preview: DecisionPreview; readonly note: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-text-primary">{preview.title}</p>
      <p className="text-sm text-text-muted">{preview.body}</p>
      <blockquote className="border-l-2 border-border pl-3 text-sm italic text-text-muted">
        {note.length === 0 ? "Your note will appear here, exactly as you write it." : `"${note}"`}
      </blockquote>
    </div>
  );
}

/**
 * The decision form Task 5's brief asks for: it previews the exact notice a member will receive
 * BEFORE the decision is submitted — the same discipline `scripts/remove-review.ts` established
 * for a human operator, moved into the product. `no_action` previews silence (ruling 6);
 * `warned_user` previews the operator's own words verbatim; `content_removed` previews the
 * generic phrase the member actually reads, which is not the operator's words at all.
 *
 * One way, once: a submitted decision cannot be edited or retried from here — a 409 (already
 * resolved) reads as an error, same as any other failure, because a second decision on the same
 * flag is a new flag, not a correction to this one (`resolveFlag`'s own docblock).
 */
export function ResolutionForm({ flagId, decisions, noteMaxLength, previews, isChatSubject }: ResolutionFormProps) {
  const { fetchJson } = useAdminRoomDeps();
  const router = useRouter();
  const legendId = useId();
  const [decision, setDecision] = useState<ResolutionDecision | null>(decisions[0] ?? null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (): Promise<void> => {
    if (decision === null) {
      setError("Choose a decision.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/admin/flags/${flagId}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      const envelope = (await response.json()) as ApiEnvelope<{ readonly flagId: string; readonly decision: ResolutionDecision }>;
      if (!envelope.ok) {
        setError(envelope.error);
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <p role="status" className="text-sm text-positive">
        Decision recorded. It cannot be changed here. A different decision is a new flag.
      </p>
    );
  }

  const preview = decision === null ? null : previews[decision];

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend id={legendId} className="text-sm font-medium text-text-primary">
          Decision
        </legend>
        <div className="flex flex-col gap-2" role="radiogroup" aria-labelledby={legendId}>
          {decisions.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm text-text-primary">
              <input type="radio" name="resolution-decision" value={option} checked={decision === option} onChange={() => setDecision(option)} className="size-4 accent-accent" />
              {DECISION_LABEL[option]}
            </label>
          ))}
        </div>
      </fieldset>

      <Textarea
        label="Your note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={maxLengthFor(decision, noteMaxLength)}
        hint={decision === "content_removed" ? "Your own words. The member reads a general reason instead. The preview below shows it." : "Your own words. Kept on the record either way."}
      />

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-elevated p-3" aria-label="What the member will see">
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">What the member sees</p>
        {decision === "no_action" ? (
          <NoActionPreview />
        ) : decision === "content_removed" && preview != null ? (
          <ContentRemovedPreview preview={preview} note={note} isChatSubject={isChatSubject} />
        ) : decision === "warned_user" && preview != null ? (
          <WarnedUserPreview preview={preview} note={note} />
        ) : (
          <p className="text-sm text-text-muted">Choose a decision to preview what the member will see.</p>
        )}
      </div>

      <p className="text-xs text-text-muted">This cannot be taken back. A corrected decision is a new flag, not an edit.</p>

      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}

      <div>
        <Button type="submit" variant="destructive" loading={submitting} disabled={submitting || decision === null}>
          Submit decision
        </Button>
      </div>
    </form>
  );
}
