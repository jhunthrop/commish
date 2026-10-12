import type { Metadata } from "next";
import { getDb } from "@research-ts/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
import { PublicBar, STOREFRONT_NAV } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";
import { invitePreview } from "@/league-service/invites";
import { formatUsd } from "@/money/config";
import { walletSummary } from "@/money-service/read";
import { InviteLanding, type InviteLandingState } from "@/league-room/components/invite-landing";
import { pageTitle } from "@/components/app-shell/page-metadata";

export const dynamic = "force-dynamic";
// A5: matches this page's own <h1> (a static "Join a league" regardless of invite outcome).
export const metadata: Metadata = pageTitle("Join a league");

interface PageProps {
  readonly params: Promise<{ readonly code: string }>;
}

/**
 * Duplicated from `@/league-service/invites`'s own three refusal constants (`INVALID`,
 * `EXPIRED`, `EXHAUSTED`) — none of the three is exported, on purpose (see that module's own
 * docblock), so this is the only way a caller outside it can tell them apart; `InviteLanding`'s
 * own copy of the same three sentences (used for DISPLAY, not matching) carries the identical
 * duplication note. A5 (Phase 3.6 addendum) requires the words stay byte-identical to that
 * module's own — they do, verified against that file. A future fourth refusal there fails safe
 * here (as "invalid") rather than throwing.
 */
const DEAD_CODE_KIND_BY_TEXT: Readonly<Record<string, "invalid" | "expired" | "exhausted">> = {
  "That invite link is not valid. Ask your commissioner for a new one.": "invalid",
  "That invite link has expired. Ask your commissioner for a new one.": "expired",
  "That invite link has already been used up. Ask your commissioner for a new one.": "exhausted",
};

function stateFor(preview: Awaited<ReturnType<typeof invitePreview>>): InviteLandingState {
  if (preview.ok) return { kind: "open", terms: preview.terms };
  return { kind: DEAD_CODE_KIND_BY_TEXT[preview.reason] ?? "invalid" };
}

/**
 * The shareable invite link's destination, and the ONE page under `/app` a signed-out visitor
 * reaches (`middleware.ts`'s single exemption, whose docblock states how tightly it is scoped).
 *
 * Lives in the `(public)` route group (Task 2), a sibling of `(shell)`: this segment DECLINES
 * `(shell)/layout.tsx`'s `AppShell` entirely — a signed-in shell around a page a stranger can
 * land on unauthenticated would be chrome nobody signed out can use, and the rail's own leagues
 * would be somebody's private list drawn beside a link anyone with the URL can open. A route
 * group changes no URL, so `/app/join/[code]` still resolves exactly as every existing invite
 * link expects.
 *
 * Phase 3.6, Task 20: `invitePreview` is now called HERE, server-side, once — the addendum's
 * `InviteLanding` (`@/league-room/components/invite-landing`) takes the resolved
 * `InviteLandingState` as a prop rather than fetching its own preview the way `JoinForm` used to.
 * That is what makes `GET /api/invites/[code]`'s documented unauthenticated ruling TRUE rather
 * than aspirational: the record says a prospect sees what they are joining "before holding an
 * account", and a server-rendered preview is what makes that true on the very first byte, signed
 * out, with no client round trip in between. Signed out, the terms render and the action is a
 * plain "Sign in" — the same idiom `OpenLeagueShelf` uses on `/browse`. Signed in, still no
 * shell renders here — `PublicBar` (Task 16) is the SIGNED-OUT chrome, so it renders only when
 * `user === null`, the same conditional the header always used; `PublicFooter` renders
 * regardless of session, because this route never gets `AppShell`'s own chrome either way and a
 * footer's trust links cost a signed-in visitor nothing.
 *
 * THE `readPreferences` READ IS GONE (Sunday v5, the no-tips ruling). Its one consumer was the
 * `helpLevel` this page handed `InviteLanding` so a guided reader's `InfoTip`s opened inline, and
 * the founder retired the tips ("the UX should explain itself, we shouldn't need tips"). A read
 * whose only output nothing renders is a query, a seeded row for a first-time visitor, and a
 * promise in a `Promise.all` for nothing.
 */
export default async function JoinPage({ params }: PageProps) {
  const [user, { code }] = await Promise.all([getCurrentUser(), params]);
  const preview = await invitePreview(getDb(), code);
  // This page's own current path — its `PublicBar`'s sign-in link and `InviteLanding`'s own
  // `SignInLink` both return here (Task 16, F6).
  const pageIntent = `/app/join/${code}`;

  // Phase 4, Task 13: `JoinForm`'s own "balance after" sentence (`PaidJoinConfirmation`) —
  // computed HERE, server-side, exactly once, and ONLY when there is a real balance to read: a
  // signed-in caller AND a league that actually carries a fee (`preview.terms.entryFeeUsd`
  // defined). Every free join — which is every join this season, `moneyIsLive()` gates paid
  // league creation dark — reads the wallet zero times, the free-season reality check this task
  // must hold: `undefined` here reads as `undefined` all the way down to `JoinForm`.
  const balanceAfterUsd =
    user !== null && preview.ok && preview.terms.entryFeeUsd !== undefined
      ? formatUsd((await walletSummary(getDb(), user.id)).availableCents - preview.terms.entryFeeCents)
      : undefined;

  return (
    <>
      {/* `STOREFRONT_NAV` (fix round 3), for the same reason the seat-hold room now carries it:
          this landing rendered a nav-less bar over a footer, so somebody following an invite
          link had one door into the rest of the product and it was the wordmark. */}
      {user === null ? <PublicBar intent={pageIntent} signedIn={false} nav={STOREFRONT_NAV} /> : null}
      {/* FULL-BLEED FRAME, MEASURED CONTENT (`docs/design-system.md`, "Layout"): the terms
          ledger keeps its own measure inside `InviteLanding`, and the strip at the foot runs
          edge to edge, the way a lower third is meant to. It was a 672px column centred in a
          1440px screen, which put the one decision on the page in the middle of nothing. */}
      <main className="flex w-full flex-col gap-4 p-4">
        <div className="max-w-2xl">
          <PageTitle>Join a league</PageTitle>
        </div>
        <InviteLanding
          state={stateFor(preview)}
          signedIn={user !== null}
          code={code}
          balanceAfterUsd={balanceAfterUsd}
        />
      </main>
      <PublicFooter />
    </>
  );
}
