import { Badge, BigNumber, Card, Manager } from "@/components/ui";
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
 * NO COMPARISON, EVER (ruling 30, carried over from `StandingPanel` unchanged). The seasons count
 * is a `TowerFigure` and not a `Stat`, which is v5 making that refusal structural rather than a
 * habit: `TowerFigure` has no `comparison` seam to leave empty. The population "every manager on
 * Commish" is one this page does not hold and would be inventing. Nothing here names another
 * manager, a league, or a rank.
 *
 * SUNDAY v5 — THE REGISTER MOVED, THE SCALE DID NOT. The figure keeps its `display-xl` hero size
 * (law 3) and its label moves from the sentence-case eyebrow to `MICRO_LABEL`, the shouted key a
 * scoreboard puts beside data. The email under the name and the tier's own standing sentence
 * carry the same move: an identifier is a shouted key, a sentence is a sentence.
 *
 * NO TIPS (founder, 2026-08-28: "the UX should explain itself, we shouldn't need tips"). The
 * `InfoTip` beside the verified badge is gone; the badge's own disclosure line — "Shown beside
 * your reviews." — is the fact a reader of this page actually needs, and it was already here.
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
    <Card as="header" className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
      {/* THE MANAGER AT 96 (P1). One object: the face, the name at the header's largest size, and
          the two facts that belong to the person rather than to the count beside them.
          The email is an identifier, not prose: faint, never a field. It stays OUT of the
          micro-label register on purpose — an address is data whose own case is part of what it
          says, and the one shouted register in this product is for keys, never for values. This
          product cannot change it here (WorkOS owns sign-in), and a disabled input is a control
          that lies about being one. */}
      <Manager
        size="2xl"
        ring="self"
        titleAs="h1"
        name={displayName}
        avatar={avatar}
        className="min-w-0 gap-4"
        meta={
          <span className="flex flex-col gap-1.5">
            <span className="truncate">{email}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              {/* NEUTRAL, not `positive`. Live green is the verdict-and-outcome channel, and a
                  participation tier is a category rather than a judgement: it names which doors
                  are open, which the sentence below says in words. */}
              <Badge>{tier === "veteran" ? "Veteran" : "Newcomer"}</Badge>
              {/* The reader's own badge (`ReviewFeed` renders the same pair about other people) —
                  the unverified case renders nothing, matching that precedent exactly. */}
              {verified ? <Badge tone="self">{VERIFIED_BADGE_LABEL}</Badge> : null}
            </span>
          </span>
        }
      />

      {/* THE ONE BIG NUMBER AND ITS BASIS (P2, P11). NO COMPARISON, EVER (ruling 30): the
          population "every manager on Commish" is one this page does not hold and would be
          inventing, so the figure is a `BigNumber` and not a `Stat` — `BigNumber` has no
          `comparison` seam to leave empty. The basis names what is being counted and where.

          START-ALIGNED AT EVERY WIDTH. The block sits at the header's right end on a desktop and
          under the manager on a phone, but its own text reads left either way: a right-aligned
          figure over a left-aligned sentence put the "2" in the middle of nothing at 360. */}
      <div className="flex shrink-0 flex-col items-start gap-2">
        <BigNumber align="start" size="lg" value={String(seasons)} basis="seasons you finished on Commish" />
        <p className="text-sm text-text-muted">{standingSentence(tier)}</p>
        {/* The privacy skeptic's disclosure standard: "Verified" is the one fact here that is not
            private, because it is the exact claim `ReviewFeed` already renders publicly beside
            every review this account posts. Say so, rather than leaving the reader to guess. */}
        {verified ? <p className="text-xs text-text-faint">Shown beside your reviews.</p> : null}
      </div>
    </Card>
  );
}
