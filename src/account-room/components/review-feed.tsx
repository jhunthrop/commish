"use client";

import { useState, type ReactNode } from "react";
import { Avatar, Badge, Button, EmptyState } from "@/components/ui";
import { VERIFIED_BADGE_LABEL } from "@/participation/verified";
import type { ApiEnvelope } from "@/lib/api/respond";
import { REVIEW_CONFIG, type ReportReasonValue } from "@/reviews/config";
import type { ReviewsPage, ReviewView } from "@/reviews/contract";
import { useAccountRoomDeps } from "../hooks/deps";

const RATING_WORD: Readonly<Record<number, string>> = {
  1: "poor",
  2: "fair",
  3: "good",
  4: "very good",
  5: "excellent",
};

/**
 * `null` renders NOTHING, not "0 out of 5". The scale starts at 1, so zero is a rating no author
 * could have chosen — it only ever came from a lookup that missed between `listReviews`' two
 * round trips, and printing it puts words in a reviewer's mouth on the one page whose promise is
 * that it shows what people actually said. The date still renders; only the rating is absent.
 */
function ratingLabel(rating: number | null): string | null {
  return rating === null ? null : `${rating} out of 5, ${RATING_WORD[rating] ?? "rated"}`;
}

/** Absolute date, same idiom as `InvitePanel`'s expiry line (`new Date(...).toLocaleDateString()`). */
function formatReviewDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

function ReportControl({ reviewId }: { readonly reviewId: string }) {
  const { fetchJson } = useAccountRoomDeps();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReasonValue>(REVIEW_CONFIG.reportReasons[0]!.value);
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  if (status === "sent") {
    return <p className="text-sm text-text-muted">Reported. Thank you.</p>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-text-muted underline hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Report
      </button>
    );
  }

  const submit = async (): Promise<void> => {
    setStatus("sending");
    setError(null);
    try {
      const response = await fetchJson(`/api/reviews/${reviewId}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const envelope = (await response.json()) as ApiEnvelope<{ readonly reported: true }>;
      if (!envelope.ok) {
        setStatus("error");
        setError(envelope.error);
        return;
      }
      setStatus("sent");
    } catch {
      setStatus("error");
      setError("We could not reach the server. Check your connection and try again.");
    }
  };

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">
          <span className="text-text-muted">Reason</span>
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value as ReportReasonValue)}
            // The mock's pill field, at the height of the `size="sm"` button beside it:
            // `border-edge`, never `border-line` — a control a user must find is bounded, a
            // surface is not (WCAG 1.4.11's own distinction, and this system's).
            className="h-8 rounded-pill border border-edge bg-surface-elevated px-3 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {REVIEW_CONFIG.reportReasons.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="button" variant="secondary" size="sm" loading={status === "sending"} disabled={status === "sending"} onClick={() => void submit()}>
          Send report
        </Button>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-negative">
          {error}
        </p>
      )}
    </div>
  );
}

function ReviewRow({ review }: { readonly review: ReviewView }) {
  const rating = ratingLabel(review.rating);
  return (
    <li className="flex flex-col gap-2 border-b border-line py-4 last:border-b-0">
      <div className="flex items-center gap-3">
        <Avatar name={review.authorName} avatar={review.authorAvatar} />
        <div className="flex flex-col">
          <span className="flex items-center gap-1">
            <span className="font-medium text-text-primary">{review.authorName}</span>
            {/* Founder decision #8: the inverted case renders NOTHING, not a negative badge —
                an unverified reviewer looks exactly like this product looked before this badge
                existed.

                NO TIPS (founder, 2026-08-28) and LAW 4 (Sunday v5), in one change. The ⓘ that
                defined the badge is gone: the badge already reads in plain English and the feed's
                own head is where a claim about the feed belongs. The tone moves from `positive`
                to `accent` because cyan is v5's VERDICT channel — "we rate him higher than the
                room does" — and a verified reviewer is not a verdict about a review; amber is the
                network's own furniture, which is exactly what this badge is. */}
            {review.verified ? <Badge tone="accent">{VERIFIED_BADGE_LABEL}</Badge> : null}
          </span>
          {/* Task 20 Step 2: the rating and the date are the one dense, scannable fact on an
              otherwise prose row — `font-mono tabular-nums`, the same idiom `LiveStatePill` and
              `SlotPreferencePanel` already use for a number meant to be scanned, not read. */}
          <span className="font-mono text-sm tabular-nums text-text-muted">
            {rating === null ? null : (
              <>
                {rating}
                {" · "}
              </>
            )}
            <time dateTime={review.createdAt}>{formatReviewDate(review.createdAt)}</time>
          </span>
        </div>
      </div>
      {/* A review is prose, not a data row — `max-w-prose` keeps its line length readable inside
          the feed's own full-bleed frame (Task 20 Step 2's measured paragraph column), the same
          width this page's own lede paragraph already carries (`src/app/reviews/page.tsx`). */}
      <p className="max-w-prose text-md text-text-primary">{review.body}</p>
      {/* E9 (Task 10): "Report" used to sit flush left, full width, its own line below the body —
          reading as a fourth thing on the page rather than a control attached to the review
          above it. `justify-end` keeps it inside THIS row (the hairline-bounded `<li>`), pinned
          to the trailing edge, so it reads as this review's own report action, not the feed's. */}
      <div className="flex justify-end">
        <ReportControl reviewId={review.id} />
      </div>
    </li>
  );
}

export interface ReviewFeedProps {
  /** The first page, read server-side — this is what makes the feed readable signed out. */
  readonly initialPage: ReviewsPage;
  /** Rendered as the empty state's action. Pass the composer when signed in, a sign-in link otherwise. */
  readonly emptyAction: ReactNode;
}

/**
 * Newest-first, exactly as `listReviews` returns it — no client-side re-sort, which is the UI
 * half of the same curation guarantee `feedQuery`'s own test proves at the query.
 */
export function ReviewFeed({ initialPage, emptyAction }: ReviewFeedProps) {
  const { fetchJson } = useAccountRoomDeps();
  const [reviews, setReviews] = useState(initialPage.reviews);
  const [hasMore, setHasMore] = useState(initialPage.hasMore);
  const [nextBefore, setNextBefore] = useState(initialPage.nextBefore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMore = async (): Promise<void> => {
    if (nextBefore === null) return;
    setLoadingMore(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/reviews?before=${encodeURIComponent(nextBefore)}`);
      const envelope = (await response.json()) as ApiEnvelope<ReviewsPage>;
      if (!envelope.ok) {
        setError(envelope.error);
        return;
      }
      setReviews((current) => [...current, ...envelope.data.reviews]);
      setHasMore(envelope.data.hasMore);
      setNextBefore(envelope.data.nextBefore);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setLoadingMore(false);
    }
  };

  if (reviews.length === 0) {
    return <EmptyState title="No reviews yet" description="Be the first to say what Commish is like to use." action={emptyAction} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Task 20 Step 1: stated ONCE for the whole feed rather than repeated inside every row's
          `ReportControl` (the report button itself carries no context of its own) — a reader
          deciding whether a review even belongs here should not have to open the report flow
          first to learn what reporting does and does not do. */}
      <p className="max-w-prose text-sm text-text-muted">
        Report reviews that break the rules. Disagreeing with a rating is not a reason to report it.
      </p>
      <ul className="flex flex-col">
        {reviews.map((review) => (
          <ReviewRow key={review.id} review={review} />
        ))}
      </ul>
      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      {hasMore ? (
        <Button type="button" variant="secondary" loading={loadingMore} disabled={loadingMore} onClick={() => void loadMore()}>
          Show more
        </Button>
      ) : null}
    </div>
  );
}
