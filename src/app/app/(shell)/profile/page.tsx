import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { Avatar, Panel, PageTitle } from "@/components/ui";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { readProfile } from "@/identity-service/profile";
import { readPreferences } from "@/identity-service/preferences";
import { myReview } from "@/review-service/reviews";
import { completedSeasonsFor } from "@/league-service/participation";
import { participationTierFor } from "@/participation/tier";
import { isVerifiedPlayer } from "@/participation/verified";
import { ProfileForm } from "@/account-room/components/profile-form";
import { HelpLevelForm } from "@/account-room/components/help-level-form";
import { NotificationSummary } from "@/account-room/components/notification-summary";
import { StandingPanel } from "@/account-room/components/standing-panel";
import { ThemeSwitcher } from "@/account-room/components/theme-switcher";
import { ReviewComposer } from "@/account-room/components/review-composer";

export const dynamic = "force-dynamic";

/**
 * A Server Component reading through the service layer directly, same rationale as the other
 * `/app` pages: idiomatic Next.js, and outside the client-boundary rule (which covers
 * `src/account-room/**`, browser code by construction). `readProfile` returning `null` would
 * mean the caller's own `users` row is gone — not a reachable state for a signed-in session,
 * but `notFound()` rather than a crash if it ever happened.
 *
 * Renders no `TopBar` and no `<main>` of its own (Task 2 Step 5) — `(shell)/layout.tsx` supplies
 * both, once, for every page in this route group.
 *
 * THE ROOM'S SHAPE (Task 18, Step 2). Full-bleed under the shell's own `<main>` (no `max-w-*`
 * here), two columns at `lg` and one below: WHO YOU ARE (crest-scale `Avatar`, `ProfileForm` —
 * which already renders `AvatarPicker` internally — and the account facts below it) beside HOW
 * THE PRODUCT TREATS YOU (`HelpLevelForm`, `NotificationSummary`, `StandingPanel`, and
 * `ThemeSwitcher`), with WHAT YOU TOLD THE WORLD (`ReviewComposer` plus the link to the public
 * feed) below both, at `max-w-prose` because it is the one section that holds prose someone
 * writes — the same "full-bleed frames, measured paragraphs" idiom `AppShell`'s own docblock
 * states.
 *
 * `completedSeasonsFor` / `participationTierFor` / `isVerifiedPlayer` are the self-standing
 * surface A15's inventory found missing (GAP -> this task): the axis that decides which leagues
 * a person may join was invisible until it refused them at a door. `StandingPanel` is the one
 * place it speaks about the reader instead.
 */
export default async function ProfilePage() {
  const user = await requireCurrentUser();
  const [profile, review, preferences, completedSeasons] = await Promise.all([
    readProfile(getDb(), user.id),
    myReview(getDb(), user.id),
    readPreferences(getDb(), user),
    completedSeasonsFor(getDb(), user.id),
  ]);
  if (profile === null) notFound();

  const tier = participationTierFor(completedSeasons, INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
  const verified = isVerifiedPlayer(completedSeasons, INTEGRITY_CONFIG.participation.verifiedSeasonCutoff);

  return (
    <>
      <PageTitle>Your profile</PageTitle>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-4" aria-label="Who you are">
          <Avatar name={profile.displayName} avatar={profile.avatar} size="lg" />
          <ProfileForm profile={profile} />
          {/* Task 18, Step 3: the email that identifies the account, as TEXT rather than a
              field — a disabled input is a control that lies about being one. This product
              cannot change it here, and the sentence below names where sign-in IS managed
              without linking to a WorkOS-hosted page this plan has not verified exists.
              Changing an email, adding MFA, seeing active sessions and deleting an account are
              four backlog rows this task's persona panel filed (ruling 34), not four controls
              invented here. */}
          <div className="flex flex-col gap-1 border-t border-line pt-4">
            <p className="text-sm font-medium text-text-primary">{user.email}</p>
            <p className="text-sm text-text-muted">This is the email that identifies your account. Commish cannot change it here. WorkOS manages your sign-in, not Commish.</p>
          </div>
        </section>
        <section className="flex flex-col gap-4" aria-label="How the product treats you">
          <Panel title="Preferences">
            <p className="text-sm text-text-muted">
              Your experience above sets this for you. Change it here any time, and changing your experience sets it again.
            </p>
            <HelpLevelForm helpLevel={preferences.helpLevel} />
          </Panel>
          <NotificationSummary />
          <StandingPanel seasons={completedSeasons} tier={tier} verified={verified} />
          <ThemeSwitcher />
        </section>
      </div>
      <section className="flex max-w-prose flex-col gap-4" aria-labelledby="review-heading">
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
    </>
  );
}
