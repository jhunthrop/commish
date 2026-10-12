import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@research/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { ButtonLink, Panel } from "@/components/ui";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { readProfile } from "@/identity-service/profile";
import { readPreferences } from "@/identity-service/preferences";
import { myReview } from "@/review-service/reviews";
import { completedSeasonsFor } from "@/league-service/participation";
import { participationTierFor } from "@/participation/tier";
import { isVerifiedPlayer } from "@/participation/verified";
import { ProfileForm } from "@/account-room/components/profile-form";
import { HelpLevelForm } from "@/account-room/components/help-level-form";
import { ManagerHeader } from "@/account-room/components/manager-header";
import { NotificationSummary } from "@/account-room/components/notification-summary";
import { ThemeSwitcher } from "@/account-room/components/theme-switcher";
import { ReviewComposer } from "@/account-room/components/review-composer";
import { pageTitle } from "@/components/app-shell/page-metadata";

export const dynamic = "force-dynamic";
/**
 * A5's " · Commish" template, with the one deliberate divergence from "matches this page's own
 * <h1>" in the product: the heading is now the MANAGER'S NAME (`ManagerHeader`, Gameday law 2)
 * and the tab stays the route's name. A tab has to be distinguishable from the other Commish
 * tabs a manager has open, which is a question about the route; a heading answers "whose is
 * this", which is a question about the person. `ManagerHeader`'s own docblock carries the
 * reasoning so the next reader of that component finds it too.
 */
export const metadata: Metadata = pageTitle("Your profile");

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
 * THE ROOM'S SHAPE (Gameday, laws 2 and 4 — replaces Task 18 Step 2's two-column version).
 *
 * The old shape was a two-column grid whose left column held one form and then stopped, so a
 * 1440px account room rendered a 700x1000px hole below the email line and put its most
 * interesting fact — how many seasons this manager has finished — in 13px at the bottom right.
 * Law 4 is exactly about that hole: *"space separates kinds of information; it never exists to
 * calm."*
 *
 * So: `ManagerHeader` first, full width — the face, the name at display scale and the seasons
 * count as this page's one hero number (laws 2 and 3). Then THREE columns at `lg`, grouped by
 * what a reader came to do rather than by component type:
 *
 * - **Who you are** — `ProfileForm` (which renders `AvatarPicker` internally) and the account
 *   facts WorkOS owns.
 * - **How the product treats you** — `HelpLevelForm`, the wallet's door, and
 *   `NotificationSummary`. (`ThemeSwitcher` left this column under Sunday v5 and became the
 *   page's foot band; see below.)
 * - **What you told the world** — `ReviewComposer`.
 *
 * Every column is a flow of `Panel`s at the same width, so no column can run out of content and
 * leave a gutter. Sunday v5 moved `NotificationSummary` one column left for exactly that reason:
 * with the theme band pulled out to the foot, the middle column ended 800px above its neighbours,
 * which is the same "space that exists to calm" the old two-column shape was rebuilt to close. The review section keeps `max-w-prose` INSIDE its own panel — it is the one
 * block that holds prose someone writes, and a measured paragraph inside a full-bleed frame is
 * the idiom `AppShell`'s own docblock states.
 *
 * `completedSeasonsFor` / `participationTierFor` / `isVerifiedPlayer` are the self-standing
 * surface A15's inventory found missing: the axis that decides which leagues a person may join
 * was invisible until it refused them at a door. `ManagerHeader` is the one place it speaks about
 * the reader instead.
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
      <ManagerHeader
        displayName={profile.displayName}
        avatar={profile.avatar}
        email={user.email}
        seasons={completedSeasons}
        tier={tier}
        verified={verified}
      />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <section className="flex flex-col gap-4" aria-label="Who you are">
          <Panel title="Your details">
            <ProfileForm profile={profile} />
            {/* Task 18, Step 3: the email that identifies the account, as TEXT rather than a
                field — a disabled input is a control that lies about being one. This product
                cannot change it here, and the sentence below names where sign-in IS managed
                without linking to a WorkOS-hosted page this plan has not verified exists.
                Changing an email, adding MFA, seeing active sessions and deleting an account are
                four backlog rows this task's persona panel filed (ruling 34), not four controls
                invented here. The address itself now reads once, in `ManagerHeader`, beside the
                face it identifies — repeating it here would be the second copy law 4 calls
                decoration. */}
            <p className="border-t border-line pt-3 text-sm text-text-muted">
              Your email identifies this account and is visible only to you. Commish cannot change it here. WorkOS manages your sign-in, not Commish.
            </p>
          </Panel>
        </section>

        <section className="flex flex-col gap-4" aria-label="How the product treats you">
          {/* The caption over this control is gone (v5 subtraction): "Your experience above sets
              this for you. Change it here any time, and changing your experience sets it again."
              restated the control's own hint back at the reader in a circle, and the `Select`
              below already says what each setting does in the words that matter. */}
          <Panel title="Preferences">
            <HelpLevelForm helpLevel={preferences.helpLevel} />
          </Panel>
          {/* The wallet's DOOR (self review D1, 2026-08-27): a repo-wide sweep found zero links
              to /app/wallet — the product's biggest trust surface was unreachable by
              construction. The member's own place is where their money door belongs. The free
              season sentence stays: money copy is load-bearing and never trimmed for register. */}
          <Panel title="Wallet">
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-text-muted">Every league is free this season, so there is nothing to deposit yet.</p>
              <ButtonLink href="/app/wallet" variant="secondary">
                Open your wallet
              </ButtonLink>
            </div>
          </Panel>
          {/* Link audit, 2026-09-04: the waiting room's "See what you will hear about" checklist
              item targets `/app/profile#notifications-heading`. The anchor's original home was
              `NotificationSummary`'s own hand-rolled section heading, and the Task 18 retone onto
              `Panel` dropped the id without moving it — so the link opened this page at the top
              and pointed at nothing. The id lives on a wrapper here, the `#invite-managers`
              idiom (`RoomShell`), so the panel keeps owning its own markup. */}
          <div id="notifications-heading">
            <NotificationSummary />
          </div>
        </section>

        <section className="flex flex-col gap-4" aria-label="What you told the world">
          <Panel title="Leave a review">
            <p className="max-w-prose text-sm text-text-muted">
              What you say here appears on the public review feed, unfiltered by rating.{" "}
              <Link href="/reviews" className="font-medium text-accent underline">
                See what managers are saying
              </Link>
              .
            </p>
            <div className="max-w-prose">
              <ReviewComposer myReview={review} />
            </div>
          </Panel>
        </section>
      </div>

      {/* SUNDAY v5, LAW 6 — the account room's foot. The theme band moved out of the middle
          column and across the whole page: it is the one decision on this route that governs
          every OTHER screen, which is what earns a lower third on a surface that is otherwise
          three columns of settings that save themselves. `ThemeSwitcher`'s own docblock carries
          the full argument, including why it is the band's geometry rather than the `LowerThird`
          primitive (a three-way preference is a control, never a verb). */}
      <ThemeSwitcher />
    </>
  );
}
