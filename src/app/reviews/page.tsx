import Link from "next/link";
import { headers } from "next/headers";
import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ErrorState, PageTitle } from "@/components/ui";
import { AppShell } from "@/components/app-shell/app-shell";
import { shellData } from "@/components/app-shell/shell-data";
import { PublicBar } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";
import { SignInLink } from "@/components/app-shell/sign-in-link";
import { listReviews, myReview } from "@/review-service/reviews";
import { ReviewComposer } from "@/account-room/components/review-composer";
import { ReviewFeed } from "@/account-room/components/review-feed";
import { browseAllowed } from "@/app/api/reviews/_shared";

export const dynamic = "force-dynamic";

/** This page's own path — every signed-out `SignInLink` on it returns here (Task 16, F6). */
const PAGE_INTENT = "/reviews";

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
 *
 * Task 2: this page sits outside `/app`, so it is never wrapped by `(shell)/layout.tsx` — it
 * calls `shellData` and renders `AppShell` ITSELF, and only when there is a user (`/reviews` is
 * reachable signed out by design). The rate-limit refusal below runs before `getCurrentUser()`
 * ever resolves, so it always renders `PublicBar` — content-neutral either way, and not worth a
 * `shellData` round trip for a request this page is about to refuse.
 *
 * Task 16: the signed-out chrome used to be a page-local `PublicHeader`, copy-pasted verbatim in
 * two other places (`/browse`, `/app/join/[code]`) — it is `PublicBar` now, everywhere, and this
 * page's own `SignInLink`s (the header's and the empty state's "write the first review" prompt,
 * F6) carry `PAGE_INTENT` so signing in returns here.
 */
export default async function ReviewsPage() {
  if (!browseAllowed((await headers()).get("x-forwarded-for"))) {
    return (
      <>
        <PublicBar intent={PAGE_INTENT} />
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
        <PublicFooter />
      </>
    );
  }

  const [user, page] = await Promise.all([getCurrentUser(), listReviews(getDb(), {})]);
  const mine = user === null ? null : await myReview(getDb(), user.id);

  const emptyAction =
    user === null || mine === null ? (
      <SignInLink intent={PAGE_INTENT} className="text-sm font-medium text-accent underline">
        Sign in to write the first review
      </SignInLink>
    ) : (
      <ReviewComposer myReview={mine} />
    );

  const content = (
    <>
      <div className="flex flex-col gap-1">
        <PageTitle>What managers are saying</PageTitle>
        <p className="text-sm text-text-muted">
          Every review, ordered by when it was written. Nothing here is filtered by rating.
        </p>
      </div>
      <ReviewFeed initialPage={page} emptyAction={emptyAction} />
    </>
  );

  if (user === null) {
    return (
      <>
        <PublicBar intent={PAGE_INTENT} />
        <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">{content}</main>
        <PublicFooter />
      </>
    );
  }

  const { rail, liveState } = await shellData(getDb(), user);
  return (
    <AppShell user={{ displayName: user.displayName, avatar: user.avatarUrl, isAdmin: user.isAdmin }} rail={rail} liveState={liveState}>
      {content}
    </AppShell>
  );
}
