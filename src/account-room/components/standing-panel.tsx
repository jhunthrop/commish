import { Badge, InfoTip, Panel, StatPill } from "@/components/ui";
import type { ParticipationTier } from "@/participation/tier";
import { VERIFIED_BADGE_LABEL } from "@/participation/verified";

export interface StandingPanelProps {
  /** `completedSeasonsFor` (`@/league-service/participation`), computed server-side and handed
   *  down as a plain number — this component has no database seam of its own, the same
   *  "props, not a fetch" shape `ReviewComposer`'s `myReview` already uses. */
  readonly seasons: number;
  /** `participationTierFor(seasons, cutoff)` — the axis that decides which leagues this account
   *  may join (`tierJoinPrecondition`, `@/league-service/join`), invisible everywhere else on the
   *  product until it refuses someone at a door. */
  readonly tier: ParticipationTier;
  /** `isVerifiedPlayer(seasons, cutoff)` — the same claim `ReviewFeed`'s badge makes about OTHER
   *  reviewers (`@/account-room/components/review-feed.tsx`), stated here about the reader. */
  readonly verified: boolean;
}

/**
 * What a manager's own participation tier OPENS, never what it costs them (ruling 30; this
 * component's own second test's docblock, verbatim below): a newcomer reads "leagues kept for
 * newer players are open to you", not "you are refused the veteran leagues" — the refusal at a
 * join door is the only OTHER place this axis speaks, and it already speaks as a refusal there.
 * This is the one place it speaks as an invitation.
 */
function standingSentence(tier: ParticipationTier): string {
  return tier === "veteran" ? "Every open league is available to you." : "Leagues kept for newer players are open to you.";
}

/**
 * The self-standing surface A15's inventory found missing (GAP -> Task 18): `completedSeasonsFor`,
 * `participationTierFor` and `isVerifiedPlayer` all already existed before this component, but
 * every reader of them was about a STRANGER — a join-door refusal (`tierJoinPrecondition`), or
 * another reviewer's badge (`ReviewFeed`). Nothing told a manager their OWN standing. This says
 * only that: no other manager's name, no league, no comparison (ruling 30) — the third test below
 * keeps that true by asserting the absence, the same discipline the refused per-manager tag (D6)
 * is checked with, rather than trusting a future edit not to reintroduce it.
 */
export function StandingPanel({ seasons, tier, verified }: StandingPanelProps) {
  return (
    <Panel title="Your standing" meta={`${seasons} season${seasons === 1 ? "" : "s"} finished on Commish`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatPill label={tier === "veteran" ? "Veteran" : "Newcomer"} tone={tier === "veteran" ? "positive" : "neutral"} />
        {/* Founder decision #8's badge, about the reader this time rather than another reviewer
            (`ReviewFeed`'s own use of the same pair, `InfoTip term="verified-reviewer"`) — the
            unverified case renders nothing, matching that precedent exactly. Fix round 1, F2 (the
            privacy skeptic's disclosure standard): this panel tells the reader what a fact OPENS,
            and "Verified" is the one fact on this panel that is not private — it is the exact
            claim `ReviewFeed` already renders publicly beside every review this account posts, so
            the line beneath the badge says exactly that, in words, rather than leaving the reader
            to guess who else sees it. */}
        {verified ? (
          <div className="flex flex-col gap-1">
            <span className="inline-flex items-center gap-0.5">
              <Badge tone="positive">{VERIFIED_BADGE_LABEL}</Badge>
              <InfoTip term="verified-reviewer" />
            </span>
            <p className="text-xs text-text-muted">Shown beside your reviews.</p>
          </div>
        ) : null}
      </div>
      <p className="text-sm text-text-muted">{standingSentence(tier)}</p>
    </Panel>
  );
}
