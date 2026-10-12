import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@research/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { BigNumber, PageTitle, SeatStack } from "@/components/ui";
import { seatSentence } from "@/components/ui/seat-meter";
import { AppShell } from "@/components/app-shell/app-shell";
import { createSheetDefaults, shellData } from "@/components/app-shell/shell-data";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { PublicBar, STOREFRONT_NAV } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";
import { resolveLeagueMembership } from "@/lib/leagues/membership";
import { publicLeaguePreview } from "@/league-service/browse";
import { LocalDraftTime } from "@/league-room/components/local-draft-time";
import { SeatHoldPanel } from "@/league-room/components/seat-hold-panel";
import { SeatConfirmPanel } from "./seat-confirm-panel";

export const dynamic = "force-dynamic";
// A5: honest static title — the real one (`preview.name`) needs a DB read this task does not own.
export const metadata: Metadata = pageTitle("Hold your seat");

interface PageProps {
  readonly params: Promise<{ readonly leagueId: string }>;
}

/** This page's own path — its `PublicBar`'s sign-in link and its interstitial's `SignInLink`
 *  both return here (Task 16, F6), and it is the `returnTo` WorkOS seals into the callback's state. */
function pageIntent(leagueId: string): string {
  return `/join/${leagueId}/hold`;
}

/**
 * When this league drafts, in one line — read once, spent by the masthead's own signed-out
 * branch and by the signed-in strip's "Drafts" cell, never written twice.
 *
 * 2026-09-11 fix round: a scheduled league's kickoff now renders through `LocalDraftTime`, the
 * SAME reader-zone upgrade every other draft-date surface carries — `preview.draftAt` used to
 * print here forever, the server's UTC bake, no matter which zone the visitor actually held a
 * seat from. `preview.draftAtIso` is the raw instant `draftAt` was formatted from.
 */
function draftLine(preview: NonNullable<Awaited<ReturnType<typeof publicLeaguePreview>>>): ReactNode {
  if (preview.startTrigger === "when_full") return "As soon as it fills";
  return <LocalDraftTime iso={preview.draftAtIso} fallback={preview.draftAt} />;
}

/**
 * THE SEAT MASTHEAD (Gameday, laws 2 and 4) — the same block for both branches of this page,
 * written once because a signed-out visitor and a signed-in member are looking at the identical
 * league and must never be shown two drawings of it.
 *
 * WHAT IT REPLACED. A 400px column in the middle of a 1600px screen: the league name, then
 * "11 of 12 seated. 1 seat left." at 13px muted, then the timing sentence at 13px muted, then the
 * panel. The most consequential fact on the page — that one seat is left — was the smallest thing
 * on it, which is precisely the uniform hierarchy law 2 exists to end. *"If the largest thing on
 * a screen is not a number or a name, the screen is wrong."*
 *
 * The figure is `teamCount − filled − held`: a held seat is somebody else's, so counting it as
 * open would be the page's one number telling its one lie. `SeatMeter` keeps the spoken sentence
 * (`srOnlySentence`) so assistive tech hears the product's single seat statement while the screen
 * shows the figure — the same split `LeagueRow` and the mock lobby's own shelf already keep.
 *
 * No tint on the figure and no `Stat`: a count of open seats sits inside no stated population,
 * and rule 1 permits a magnitude colour only where the comparison is genuine.
 */
function SeatMasthead({
  preview,
  timing,
}: {
  readonly preview: NonNullable<Awaited<ReturnType<typeof publicLeaguePreview>>>;
  /** The draft-timing line, or null when the page's own lower third is carrying it instead
   *  (the signed-in branch). The signed-out interstitial has no strip of its own — its action
   *  is `SeatHoldPanel`'s hold-and-sign-in flow — so it keeps the line here. `ReactNode` (not
   *  `string`) since 2026-09-11: a scheduled league's value is `LocalDraftTime`, which upgrades
   *  itself to the reader's own zone after mount. */
  readonly timing: ReactNode | null;
}) {
  const open = Math.max(0, preview.teamCount - preview.filledTeams - preview.heldSeats);
  return (
    <div className="flex flex-col gap-4 border-b border-line pb-6">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        {/* The draft-timing line moves to the lower third at the foot wherever there IS one
            (Sunday v5, law 6): it is a fact the decision rests on, and the strip is where those
            sit. Stating it in both places would be the same fact twice on a screen with one
            decision on it. */}
        {/* P1: who is in, before the number — the seats themselves on a signed-out surface
            (`SeatStack`'s docblock on why these are not faces). */}
        <div className="flex min-w-0 flex-col gap-2">
          <PageTitle>{preview.name}</PageTitle>
          <SeatStack filled={preview.filledTeams} total={preview.teamCount} heldSeats={preview.heldSeats} />
          {timing === null ? null : <p className="text-sm tabular-nums text-text-muted">Drafts {timing}</p>}
        </div>
        {/* P2: the page's ONE number, with its basis in the same glance — through `BigNumber`,
            which owns both halves; the hand-rolled figure-plus-micro-label pair it replaces was
            this composition spelled a second way. */}
        <div data-testid="hold-seats-open" className="shrink-0">
          <BigNumber value={String(open)} basis={`${open === 1 ? "seat" : "seats"} open of ${preview.teamCount}`} size="xl" />
        </div>
      </div>
      {/* The product's ONE seat sentence (F17), spoken only: `SeatStack` above already draws
          the same shape, and the meter's bar beside it was that shape twice. */}
      <span className="sr-only">{seatSentence(preview.filledTeams, preview.teamCount, preview.heldSeats)}</span>
    </div>
  );
}

/**
 * The seat hold's own screens (Task 6 Step 4), all on one route: `/join/[leagueId]/hold`.
 *
 * **Signed out — the interstitial.** The league's own facts, a live seat count, and
 * `SeatHoldPanel` — which claims the hold itself and renders the countdown plus `SignInLink`
 * (`intent={pageIntent(leagueId)}`), so the visitor who signs in comes back to this exact URL.
 *
 * **Signed in — READ ONLY (A1, 2026-08-27 flow analysis, finding 1).** This branch used to call
 * `returnFromSignIn` — a WRITE — during RENDER: navigating to this URL silently seated a member,
 * no confirm, no exit, and any GET (a prefetch, a crawler, a shared link) triggered it. This
 * render no longer writes anything, ever. It reads the SAME league facts the signed-out branch
 * reads (`publicLeaguePreview`, one leveled 404 for "missing" and "private" either way — the
 * same collapse `publicLeaguePreview`'s own docblock already commits to) and renders
 * `SeatConfirmPanel`'s one-tap "Take your seat in `<League>`" confirm. `returnFromSignIn` itself
 * (`@/league-service/join`) is UNCHANGED — same signature, same three outcomes, same hold/expiry
 * semantics — it now runs exactly once, behind that panel's own POST (`./confirm/route.ts`),
 * triggered by the visitor's own tap, never by a GET.
 */
export default async function SeatHoldPage({ params }: PageProps) {
  const { leagueId } = await params;
  const user = await getCurrentUser();
  const preview = await publicLeaguePreview(getDb(), leagueId);
  if (preview === null) notFound();

  if (user === null) {
    return (
      <>
        {/* `STOREFRONT_NAV` (fix round 3): this room rendered a nav-less bar over a footer, so
            a first-timer deciding whether to sign in for a seat had exactly one door back into
            the product and it was the wordmark — the same defect `ReadingFrame` records fixing
            on `/support`, on a screen where "How it works" is the question a stranger most has.
            The hold survives leaving the page: the server holds the seat, not this render. */}
        <PublicBar intent={pageIntent(leagueId)} signedIn={user !== null} nav={STOREFRONT_NAV} />
        {/* FULL-BLEED FRAME, MEASURED CONTENT (`docs/design-system.md`, "Layout"): the masthead
            spans the page so the seat count sits at the far edge where a manager's eye lands,
            and only the decision card takes a measure. It was a 400px column centred in a
            1600px screen — 75% of the page carrying nothing at all. */}
        <main className="flex w-full flex-col gap-6 p-4">
          <SeatMasthead preview={preview} timing={draftLine(preview)} />
          <div className="max-w-xl">
            <SeatHoldPanel leagueId={leagueId} leagueName={preview.name} />
          </div>
        </main>
        <PublicFooter />
      </>
    );
  }

  const { rail, liveState } = await shellData(getDb(), user);
  const shellUser = { displayName: user.displayName, avatar: user.avatarUrl, isAdmin: user.isAdmin };

  // ALREADY SEATED (flow-remediation review A-3): a member with a team in this league was being
  // offered "Take your seat", tapped it, and was silently redirected into a league they were
  // already in — the analysis's own "same fact stated twice, differently" pattern, and a
  // pointless write-shaped action. A READ decides it here (`resolveLeagueMembership` is a pure
  // SELECT — this page's no-write-on-render law is untouched) and sends them where they were
  // going anyway.
  const membership = await resolveLeagueMembership(getDb(), leagueId, user.id);
  if (membership.ok && membership.membership.teamId !== null) redirect(`/app/leagues/${leagueId}`);

  return (
    <AppShell user={shellUser} rail={rail} liveState={liveState} createDefaults={createSheetDefaults()}>
      <main className="flex w-full flex-col gap-6 p-4">
        <SeatMasthead preview={preview} timing={null} />
        <SeatConfirmPanel
          leagueId={leagueId}
          leagueName={preview.name}
          draftLine={draftLine(preview)}
          houseRung={preview.houseRung}
        />
      </main>
    </AppShell>
  );
}
