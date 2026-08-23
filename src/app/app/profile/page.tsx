import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
import { TopBar } from "@/components/app-shell/top-bar";
import { readProfile } from "@/identity-service/profile";
import { readPreferences } from "@/identity-service/preferences";
import { myReview } from "@/review-service/reviews";
import { ProfileForm } from "@/account-room/components/profile-form";
import { HelpLevelForm } from "@/account-room/components/help-level-form";
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
  const [profile, review, preferences] = await Promise.all([
    readProfile(getDb(), user.id),
    myReview(getDb(), user.id),
    readPreferences(getDb(), user),
  ]);
  if (profile === null) notFound();

  return (
    <>
      <TopBar displayName={user.displayName} avatar={user.avatarUrl} isAdmin={user.isAdmin} />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4">
        <PageTitle>Your profile</PageTitle>
        <ProfileForm profile={profile} />
        <section className="flex flex-col gap-4" aria-labelledby="preferences-heading">
          <div className="flex flex-col gap-1">
            <h2 id="preferences-heading" className="text-lg font-semibold text-text-primary">
              Preferences
            </h2>
            <p className="text-sm text-text-muted">
              Your experience above sets this for you. Change it here any time, and changing your
              experience sets it again.
            </p>
          </div>
          <HelpLevelForm helpLevel={preferences.helpLevel} />
        </section>
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
          <ReviewComposer myReview={review} />
        </section>
      </main>
    </>
  );
}
