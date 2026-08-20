import Link from "next/link";
import { headers } from "next/headers";
import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ErrorState, PageTitle } from "@/components/ui";
import { AppHeader } from "@/components/app-shell/app-header";
import { listReviews, myReview } from "@/review-service/reviews";
import { ReviewComposer } from "@/account-room/components/review-composer";
import { ReviewFeed } from "@/account-room/components/review-feed";
import { browseAllowed } from "@/app/api/reviews/_shared";

export const dynamic = "force-dynamic";

/** The signed-out chrome, shared by the feed and the over-the-ceiling refusal below it. */
function PublicHeader() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-3">
        <Link
          href="/"
          className="font-display text-xl font-bold uppercase tracking-wide text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Commish
        </Link>
        <Link href="/sign-in" className="text-sm font-medium text-accent underline">
          Sign in
        </Link>
      </div>
    </header>
  );
}

/**
 * The unfiltered public review feed — this product's second unauthenticated read, after
 * `/browse`. Readable signed out on purpose: the first-timer persona this page is for has not
 * signed up yet, and a review feed that only shows itself to existing customers has told you
 * what it thinks its own reviews are worth.
 *
 * The empty state's action IS `ReviewComposer` for a signed-in visitor — the one place on this
 * page a review can be written from directly, for the cold-start case where nobody has left one
 * yet. Once the feed has content, writing or editing a review is done from `/app/profile`
 * (`ProfileForm`'s neighbor section), which this page does not duplicate.
 *
 * RATE LIMITED BEFORE IT QUERIES, from the same per-IP bucket as `GET /api/reviews`
 * (`browseAllowed`, `@/app/api/reviews/_shared`). This page runs the identical `listReviews`
 * query the API route does; guarding only the API door would mean the documented defense for an
 * unauthenticated read is bypassed by choosing the other one. Over the ceiling, nothing is read
 * at all — the refusal renders instead of the feed.
 */
export default async function ReviewsPage() {
  if (!browseAllowed((await headers()).get("x-forwarded-for"))) {
    return (
      <>
        <PublicHeader />
        <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
          <ErrorState
            title="Too many requests"
            description="You've loaded this page a lot in the last minute. Wait a minute and reload."
            action={
              <Link href="/" className="text-sm font-medium text-accent underline">
                Go to the home page
              </Link>
            }
          />
        </main>
      </>
    );
  }

  const [user, page] = await Promise.all([getCurrentUser(), listReviews(getDb(), {})]);
  const mine = user === null ? null : await myReview(getDb(), user.id);

  const emptyAction =
    user === null || mine === null ? (
      <Link href="/sign-in" className="text-sm font-medium text-accent underline">
        Sign in to write the first review
      </Link>
    ) : (
      <ReviewComposer myReview={mine} />
    );

  return (
    <>
      {user === null ? <PublicHeader /> : <AppHeader displayName={user.displayName} avatar={user.avatarUrl} />}

      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
        <div className="flex flex-col gap-1">
          <PageTitle>What managers are saying</PageTitle>
          <p className="text-sm text-text-muted">
            Every review, ordered by when it was written. Nothing here is filtered by rating.
          </p>
        </div>
        <ReviewFeed initialPage={page} emptyAction={emptyAction} />
      </main>
    </>
  );
}
