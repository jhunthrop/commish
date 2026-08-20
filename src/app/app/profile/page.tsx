import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
import { AppHeader } from "@/components/app-shell/app-header";
import { readProfile } from "@/identity-service/profile";
import { myReview } from "@/review-service/reviews";
import { ProfileForm } from "@/account-room/components/profile-form";
import { NotificationSummary } from "@/account-room/components/notification-summary";
import { ReviewComposer } from "@/account-room/components/review-composer";

export const dynamic = "force-dynamic";

/**
 * A Server Component reading through the service layer directly, same rationale as the other
 * `/app` pages: idiomatic Next.js, and outside the client-boundary rule (which covers
 * `src/account-room/**`, browser code by construction). `readProfile` returning `null` would
 * mean the caller's own `users` row is gone — not a reachable state for a signed-in session,
 * but `notFound()` rather than a crash if it ever happened.
 */
export default async function ProfilePage() {
  const user = await requireCurrentUser();
  const [profile, review] = await Promise.all([readProfile(getDb(), user.id), myReview(getDb(), user.id)]);
  if (profile === null) notFound();

  return (
    <>
      <AppHeader displayName={user.displayName} avatar={user.avatarUrl} />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
        <PageTitle>Your profile</PageTitle>
        <ProfileForm profile={profile} />
        <NotificationSummary />
        <section className="flex flex-col gap-4" aria-labelledby="review-heading">
          <div className="flex flex-col gap-1">
            <h2 id="review-heading" className="text-lg font-semibold text-text-primary">
              Leave a review
            </h2>
            <p className="text-sm text-text-muted">
              What you say here appears on the public review feed, unfiltered by rating.{" "}
              <Link href="/reviews" className="font-medium text-accent underline">
                See what managers are saying
              </Link>
              .
            </p>
          </div>
          <ReviewComposer existingReview={review} />
        </section>
      </main>
    </>
  );
}
