"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Button, Textarea } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import { REVIEW_CONFIG, removalSentenceFor } from "@/reviews/config";
import { validateReviewDraft } from "@/reviews/validate";
import type { MyReviewState, ReviewView } from "@/reviews/contract";
import { useAccountRoomDeps } from "../hooks/deps";

const RATING_LABELS = ["1, poor", "2, fair", "3, good", "4, very good", "5, excellent"] as const;

export interface ReviewComposerProps {
  /** The caller's own review and its state, loaded server-side — same precedent as
   *  `ProfileForm`'s `profile` prop. */
  readonly myReview: MyReviewState;
  /** Called after a successful submit with the review as the server now has it. */
  readonly onSubmitted?: (review: ReviewView) => void;
}

/**
 * The state a REMOVED author sees instead of an editable form. `submitReview` refuses their
 * write at the database (`setWhere: removed_at IS NULL`), so rendering the form would be an
 * invitation to type something the server will never accept — and rendering it while saying
 * "Editing replaces it." is the shadow-ban this replaces. Not a dead end: the feed they were
 * removed from is one link away, and the reason is named in words rather than in a code
 * (`removalSentenceFor`, the one definition this sentence has).
 */
function RemovedNotice({ reason }: { readonly reason: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-elevated p-4">
      <p className="text-sm font-medium text-text-primary">{removalSentenceFor(reason)}</p>
      <p className="text-sm text-text-muted">
        Everything you wrote is kept on record, and it no longer appears in public.{" "}
        <Link href="/reviews" className="font-medium text-accent underline">
          Read what other managers are saying
        </Link>
        .
      </p>
    </div>
  );
}

/**
 * A star glyph has no accessible name, so rating is a radio group labeled in words — "1, poor"
 * through "5, excellent" — not five identical stars a screen reader can't tell apart.
 *
 * The live remaining-character count and the submit-time validation both read
 * `validateReviewDraft` (`@/reviews/validate`) — the SAME rule `submitReviewSchema` enforces at
 * the API boundary — so this form can never promise a length the server then rejects.
 */
export function ReviewComposer({ myReview, onSubmitted }: ReviewComposerProps) {
  const existingReview = myReview.state === "live" ? myReview.review : null;
  const { fetchJson } = useAccountRoomDeps();
  const legendId = useId();
  const [rating, setRating] = useState<number | null>(existingReview?.rating ?? null);
  const [body, setBody] = useState(existingReview?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const submit = async (): Promise<void> => {
    setSaved(false);
    if (rating === null) {
      setError("Choose a rating.");
      return;
    }
    const draft = { rating, body };
    const validation = validateReviewDraft(draft);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetchJson("/api/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const envelope = (await response.json()) as ApiEnvelope<ReviewView>;
      if (!envelope.ok) {
        setError(envelope.error);
        return;
      }
      setSaved(true);
      onSubmitted?.(envelope.data);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  // After the hooks, never before them: the state is a prop, and React needs the same hook
  // order on every render regardless of which branch this component takes.
  if (myReview.state === "removed") return <RemovedNotice reason={myReview.reason} />;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {existingReview === null ? null : (
        <p className="text-sm text-text-muted">You&apos;ve already left a review. Editing replaces it.</p>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend id={legendId} className="text-sm font-medium text-text-primary">
          Rating
        </legend>
        <div className="flex flex-wrap gap-3" role="radiogroup" aria-labelledby={legendId}>
          {RATING_LABELS.map((label, index) => {
            const value = index + 1;
            return (
              <label key={value} className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="radio"
                  name="review-rating"
                  value={value}
                  checked={rating === value}
                  onChange={() => setRating(value)}
                  className="size-4 accent-accent"
                />
                {label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <Textarea
        label="Your review"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={REVIEW_CONFIG.body.maxLength}
        hint={`Tell other managers what using Commish is like. At least ${REVIEW_CONFIG.body.minLength} characters.`}
      />

      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" loading={saving} disabled={saving}>
          {existingReview === null ? "Post review" : "Save changes"}
        </Button>
        <span role="status" className="text-sm text-positive">
          {saved ? "Saved." : ""}
        </span>
      </div>
    </form>
  );
}
