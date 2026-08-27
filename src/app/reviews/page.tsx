import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ErrorState, PageTitle } from "@/components/ui";
import { AppShell } from "@/components/app-shell/app-shell";
import { shellData } from "@/components/app-shell/shell-data";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { PublicBar } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";
import { SignInLink } from "@/components/app-shell/sign-in-link";
import { listReviews, myReview } from "@/review-service/reviews";
import { ReviewComposer } from "@/account-room/components/review-composer";
import { ReviewFeed } from "@/account-room/components/review-feed";
import { browseAllowed } from "@/app/api/reviews/_shared";
import { excludeFixtureReviews } from "./fixture-filter";

export const dynamic = "force-dynamic";
// A5: the front door's own nav label for this route (`src/app/page.tsx:37`-adjacent list).
export const metadata: Metadata = pageTitle("Reviews");

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
        {/* `false` on purpose: this refusal returns BEFORE `getCurrentUser()` resolves (see this
            page's own docblock), and a rate-limited request is not worth a session round trip to
            personalise a header nobody is reading. */}
        <PublicBar intent={PAGE_INTENT} signedIn={false} />
        {/* Full-bleed, no `max-w-*` (NEW-2) — matching `AppShell`'s own signed-in `<main>`. */}
        <main className="flex w-full min-w-0 flex-col gap-6 px-4 py-4">
          <ErrorState
            title="Too many requests"
            description="You have loaded this page a lot in the last minute. Wait a minute and reload."
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

  const [user, rawPage] = await Promise.all([getCurrentUser(), listReviews(getDb(), {})]);
  const mine = user === null ? null : await myReview(getDb(), user.id);

  // D3 (flow analysis; storefront review): a fixture review — the site's own one review today,
  // filed by the onboarding e2e spec — never reaches a stranger deciding whether to sign up. See
  // `./fixture-filter`'s own docblock for the exact signature and its known limitation. Once the
  // fixture is excluded, an otherwise-empty result renders `ReviewFeed`'s own honest empty state
  // ("No reviews yet. Be the first to say what Commish is like to use.") rather than a lone
  // one-star complaint — no separate branch needed here, `ReviewFeed` already does this for any
  // page whose `reviews` array is empty.
  const page = { ...rawPage, reviews: excludeFixtureReviews(rawPage.reviews) };

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
        <p className="max-w-prose text-sm text-text-muted">
          Every review, ordered by when it was written. Nothing here is filtered by rating.
        </p>
      </div>
      <ReviewFeed initialPage={page} emptyAction={emptyAction} />
    </>
  );

  if (user === null) {
    return (
      <>
        <PublicBar intent={PAGE_INTENT} signedIn={user !== null} />
        {/* Full-bleed, no `max-w-*` (NEW-2) — matching `AppShell`'s own signed-in `<main>`. The
            feed itself is dense cards; the one long-form paragraph on this page keeps its own
            `max-w-prose` below, so the reading column stays measured inside the wide frame. */}
        <main className="flex w-full min-w-0 flex-col gap-6 px-4 py-4">{content}</main>
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
