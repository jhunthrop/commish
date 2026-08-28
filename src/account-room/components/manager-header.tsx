import { Avatar, Badge, Card, InfoTip, PageTitle, Stat } from "@/components/ui";
import type { ParticipationTier } from "@/participation/tier";
import { VERIFIED_BADGE_LABEL } from "@/participation/verified";

export interface ManagerHeaderProps {
  /** `readProfile(...).displayName` — the manager's own name, and this page's `<h1>`. */
  readonly displayName: string;
  /** The STORED avatar ref (`users.avatar_url`), passed straight to `Avatar`. */
  readonly avatar: string | null;
  /** The address that identifies the account, visible only to its owner. */
  readonly email: string;
  /** `completedSeasonsFor` (`@/league-service/participation`), computed server-side. */
  readonly seasons: number;
  /** `participationTierFor(seasons, cutoff)` — the axis that decides which leagues this account
   *  may join (`tierJoinPrecondition`, `@/league-service/join`). */
  readonly tier: ParticipationTier;
  /** `isVerifiedPlayer(seasons, cutoff)` — the claim `ReviewFeed` already makes publicly beside
   *  every review this account posts. */
  readonly verified: boolean;
}

/**
 * What a manager's own participation tier OPENS, never what it costs them (ruling 30): a
 * newcomer reads "leagues kept for newer players are open to you", not "you are refused the
 * veteran leagues". The refusal at a join door is the only OTHER place this axis speaks, and it
 * already speaks as a refusal there. This is the one place it speaks as an invitation.
 */
function standingSentence(tier: ParticipationTier): string {
  return tier === "veteran" ? "Every open league is available to you." : "Leagues kept for newer players are open to you.";
}

/**
 * THE ACCOUNT ROOM'S OBJECT (Gameday, laws 2 and 3).
 *
 * Replaces `StandingPanel`, which stated the same three facts (seasons, tier, verified) as a
 * 13px caption in a panel near the bottom right of the page. Two laws were failing at once and
 * the panel was where both showed:
 *
 * **Law 2, the number is the hero.** *"If the largest thing on a screen is not a number or a
 * name, the screen is wrong."* The largest thing on the account room was the words "Your
 * profile" — a route label, which is neither. It is now the manager's own name, at the display
 * scale, beside the one number this page actually holds. Seasons finished is a `Stat` at
 * `display-xl` and its label at 11px, which is the range law 2 asks for spent on the only fact
 * here that is a count.
 *
 * **Law 3, a player is an object.** A manager is the object of their own account room and was
 * drawn as a form with a small circle above it. Face, name and record now arrive together, as
 * one thing, the way every other object in the product does.
 *
 * NO COMPARISON, EVER (ruling 30, carried over from `StandingPanel` unchanged). The seasons
 * count takes no `comparison`, so it renders as ordinary ink rather than a magnitude tint: the
 * population "every manager on Commish" is one this page does not hold and would be inventing.
 * Nothing here names another manager, a league, or a rank.
 *
 * THE PAGE'S `<h1>` IS THE PERSON, AND THE BROWSER TAB IS STILL THE ROUTE. `ProfilePage`'s
 * `metadata` stays "Your profile" (A5's " · Commish" template) deliberately: a tab has to be
 * distinguishable from the twenty-eight other Commish tabs a manager may have open, which is a
 * question about the route, while a page heading answers "whose is this", which is a question
 * about the person. They are different questions and this is the one page where the two answers
 * genuinely differ.
 */
export function ManagerHeader({ displayName, avatar, email, seasons, tier, verified }: ManagerHeaderProps) {
  return (
    <Card as="header" className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={displayName} avatar={avatar} size="lg" />
        <div className="flex min-w-0 flex-col">
          <PageTitle>{displayName}</PageTitle>
          {/* The email is an identifier, not prose: mono, faint, and never a field. This product
              cannot change it here (WorkOS owns sign-in), and a disabled input is a control that
              lies about being one. */}
          <p className="truncate font-mono text-xs text-text-faint">{email}</p>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-4 lg:gap-6">
        <Stat label="Seasons finished" value={String(seasons)} size="xl" />
        <div className="flex flex-col gap-1 border-l border-line pl-4 lg:pl-6">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={tier === "veteran" ? "positive" : "neutral"}>{tier === "veteran" ? "Veteran" : "Newcomer"}</Badge>
            {/* Founder decision #8's badge, about the reader this time rather than another
                reviewer (`ReviewFeed`'s own use of the same pair) — the unverified case renders
                nothing, matching that precedent exactly. */}
            {verified ? (
              <span className="inline-flex items-center gap-0.5">
                <Badge tone="positive">{VERIFIED_BADGE_LABEL}</Badge>
                <InfoTip term="verified-reviewer" />
              </span>
            ) : null}
          </div>
          <p className="text-sm text-text-muted">{standingSentence(tier)}</p>
          {/* Fix round 1, F2 (the privacy skeptic's disclosure standard), kept verbatim from
              `StandingPanel`: "Verified" is the one fact here that is not private, because it is
              the exact claim `ReviewFeed` already renders publicly beside every review this
              account posts. Say so, rather than leaving the reader to guess who else sees it. */}
          {verified ? <p className="text-xs text-text-faint">Shown beside your reviews.</p> : null}
        </div>
      </div>
    </Card>
  );
}
