"use client";

import { useState } from "react";
import Link from "next/link";
import type { LeagueTerms } from "@/league";
import type { HelpLevel } from "@/identity/preferences";
import { Panel, Crest } from "@/components/ui";
import { StatePanel } from "@/components/ui/state-panel";
import { SignInLink } from "@/components/app-shell/sign-in-link";
import { LeagueTermsPanel } from "./league-terms-panel";
import { SeatTakenPanel } from "./seat-taken-panel";
import { JoinForm } from "./join-form";

/**
 * Duplicated from `@/league-service/invites`'s own three refusal constants (`INVALID`,
 * `EXPIRED`, `EXHAUSTED`) — never imported, because none of the three is exported (the invite
 * module keeps them module-private on purpose) and `@/league-service` is blocked as a value
 * import from `src/league-room/**` anyway (the client boundary, `eslint.config.mjs`'s
 * `SERVER_ONLY_MODULE_GROUPS`) — the same reasoning `SCORING_LABEL_TERM`/`WHEN_FULL_FILLING_NOTE`
 * (`@/league/terms.ts`) already duplicate across for. A5 (Phase 3.6 addendum) requires these stay
 * byte-identical to `invites.ts`'s own words, unchanged — they are, verified against that file.
 */
const DEAD_CODE_TEXT: Readonly<Record<"invalid" | "expired" | "exhausted", string>> = {
  invalid: "That invite link is not valid. Ask your commissioner for a new one.",
  expired: "That invite link has expired. Ask your commissioner for a new one.",
  exhausted: "That invite link has already been used up. Ask your commissioner for a new one.",
};

/** Duplicated from `@/league-service/enforcement`'s `ENFORCEMENT_REFUSALS.join` — same reasoning
 *  as `DEAD_CODE_TEXT` above, and the same sentence `SeatHoldPage`'s own tier-refusal branch
 *  (`src/app/join/[leagueId]/hold/page.tsx`) already renders for the shelf's identical refusal. */
const TIER_REFUSED_TEXT =
  "This league is reserved for newer players so everyone starts on a level footing. Browse the open leagues to find one you can join.";

export type InviteLandingState =
  | { readonly kind: "open"; readonly terms: LeagueTerms }
  | { readonly kind: "invalid" }
  | { readonly kind: "expired" }
  | { readonly kind: "exhausted" }
  | { readonly kind: "already-member"; readonly leagueId: string; readonly name: string }
  | { readonly kind: "league-full"; readonly name: string }
  | { readonly kind: "draft-started"; readonly name: string }
  | { readonly kind: "tier-refused" };

export interface InviteLandingProps {
  readonly state: InviteLandingState;
  /** Only the "open" state reads this — whether `JoinForm` or a plain `SignInLink` is the action.
   *  Defaults to `true` so every terminal state's own test can omit it. */
  readonly signedIn?: boolean;
  /** The invite code — needed only by the "open" state, for `SignInLink`'s intent and
   *  `JoinForm`'s accept call. */
  readonly code?: string;
  readonly helpLevel?: HelpLevel;
}

const BROWSE_LINK_CLASS = "text-sm font-medium text-accent underline";

/**
 * The invite path's own two real actions (F15, per the controller's ruling): "browse open
 * leagues" and nothing more specific, because an invite code never names a house rung (house
 * leagues take no invites at all — a code that tried would already have collapsed to `invalid`,
 * the non-oracle answer, before this ever renders). The shelf's own hold interstitial
 * (`SeatHoldPage`'s `seatTakenActions`) has a THIRD case for exactly the rung it can hold a seat
 * in; this landing has no such case to have.
 */
function shelfActions() {
  return {
    primaryAction: (
      <Link href="/browse" className={BROWSE_LINK_CLASS}>
        Browse open leagues
      </Link>
    ),
    secondaryAction: (
      <Link href="/browse" className={BROWSE_LINK_CLASS}>
        See leagues closest to filling
      </Link>
    ),
  };
}

/**
 * A5's nine states (the eight kinds above, with "open" rendering twice — signed in and signed
 * out — for nine renders total), the addendum's second public room.
 *
 * **The invite path takes no seat hold** (F15, per the controller's ruling, stated in this
 * component's own docblock rather than left as an unexplained asymmetry with the shelf): a code
 * is not a public shelf card that strangers race each other for. It was sent to a person, by a
 * commissioner who controls who is coming into their own league — holding capacity on behalf of
 * whoever merely opened the link would take a seat from the invitee the commissioner actually
 * meant. This landing says what is true right now (open, or not) and never promises a hold this
 * product deliberately does not place here.
 */
export function InviteLanding({ state: initialState, signedIn = true, code, helpLevel }: InviteLandingProps) {
  const [state, setState] = useState<InviteLandingState>(initialState);

  if (state.kind === "invalid" || state.kind === "expired" || state.kind === "exhausted") {
    return (
      <StatePanel
        tone="neutral"
        icon="alert-triangle"
        title="This invite cannot be used"
        description={DEAD_CODE_TEXT[state.kind]}
        action={
          <Link href="/browse" className={BROWSE_LINK_CLASS}>
            Browse open leagues
          </Link>
        }
      />
    );
  }

  // F15: the same panel the shelf's own race loser sees (`SeatTakenPanel`, the parent's Task 6
  // Step 4) — never a second hand-written "sorry, it filled" screen for the invited friend who
  // is owed the identical care. `primaryAction`/`secondaryAction` are props precisely so this
  // landing can pass the actions that make sense from an invite rather than the shelf's own.
  if (state.kind === "league-full" || state.kind === "draft-started") {
    const { primaryAction, secondaryAction } = shelfActions();
    return <SeatTakenPanel leagueName={state.name} primaryAction={primaryAction} secondaryAction={secondaryAction} />;
  }

  if (state.kind === "tier-refused") {
    return (
      <StatePanel
        tone="neutral"
        icon="shield"
        title="This league is not open to you"
        description={TIER_REFUSED_TEXT}
        action={
          <Link href="/browse" className={BROWSE_LINK_CLASS}>
            Browse open leagues
          </Link>
        }
      />
    );
  }

  if (state.kind === "already-member") {
    return (
      <Panel title="Already a member">
        <div className="flex items-center gap-3">
          <Crest id={state.leagueId} label={state.name.slice(0, 2).toUpperCase()} size={40} />
          <p className="text-sm text-text-primary">{`You are already a member of ${state.name}.`}</p>
        </div>
        <Link
          href={`/app/leagues/${state.leagueId}`}
          className="inline-flex h-10 w-fit min-w-0 items-center justify-center [overflow-wrap:anywhere] rounded-md bg-accent px-4 font-medium text-accent-text transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          {`Go to ${state.name}`}
        </Link>
      </Panel>
    );
  }

  // `state.kind === "open"` — the only branch left.
  return (
    <div className="flex flex-col gap-3">
      {/* First-timer persona review (Phase 3.5, Task 8 fix round 1): nothing anywhere in the
          invite flow said what JOINING MEANS. Lives here, not in `LeagueTermsPanel` — that
          component also renders post-join inside the league itself (Task 8), where this sentence
          would be stale and confusing (you already ARE in the draft and season). Shown regardless
          of session: a signed-out visitor deciding whether to sign in benefits from knowing what
          they are signing up for too. */}
      <p className="text-sm text-text-muted">
        {"Joining puts you in the draft and the season that follows. You will set a lineup every week."}
      </p>
      <LeagueTermsPanel terms={state.terms} helpLevel={helpLevel} />
      {signedIn ? (
        <JoinForm
          code={code ?? ""}
          terms={state.terms}
          onAlreadyMember={(leagueId) => setState({ kind: "already-member", leagueId, name: state.terms.name })}
          onLeagueFull={() => setState({ kind: "league-full", name: state.terms.name })}
          onDraftStarted={() => setState({ kind: "draft-started", name: state.terms.name })}
          onTierRefused={() => setState({ kind: "tier-refused" })}
        />
      ) : (
        // This page's own path (Task 16, F6) — signing in returns here, to the same invite,
        // rather than dropping the visitor at a generic `/app`.
        <SignInLink
          intent={`/app/join/${code ?? ""}`}
          className="inline-flex h-10 w-fit min-w-0 items-center justify-center [overflow-wrap:anywhere] rounded-md bg-accent px-4 font-medium text-accent-text transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        />
      )}
    </div>
  );
}
