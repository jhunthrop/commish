import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
import { SeatMeter } from "@/components/ui/seat-meter";
import { AppShell } from "@/components/app-shell/app-shell";
import { shellData } from "@/components/app-shell/shell-data";
import { pageTitle } from "@/components/app-shell/page-metadata";
import { PublicBar } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";
import { resolveLeagueMembership } from "@/lib/leagues/membership";
import { publicLeaguePreview } from "@/league-service/browse";
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
        <PublicBar intent={pageIntent(leagueId)} />
        <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
          <PageTitle>{preview.name}</PageTitle>
          <SeatMeter filled={preview.filledTeams} total={preview.teamCount} heldSeats={preview.heldSeats} />
          <p className="text-sm text-text-muted">
            {preview.startTrigger === "when_full" ? "Starts as soon as it fills" : `Drafts ${preview.draftAt}`}
          </p>
          <SeatHoldPanel leagueId={leagueId} leagueName={preview.name} />
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
    <AppShell user={shellUser} rail={rail} liveState={liveState}>
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
        <PageTitle>{preview.name}</PageTitle>
        <SeatMeter filled={preview.filledTeams} total={preview.teamCount} heldSeats={preview.heldSeats} />
        <p className="text-sm text-text-muted">
          {preview.startTrigger === "when_full" ? "Starts as soon as it fills" : `Drafts ${preview.draftAt}`}
        </p>
        <SeatConfirmPanel leagueId={leagueId} leagueName={preview.name} houseRung={preview.houseRung} />
      </main>
    </AppShell>
  );
}
