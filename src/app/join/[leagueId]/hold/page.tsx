import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PageTitle } from "@/components/ui";
import { StatePanel } from "@/components/ui/state-panel";
import { SeatMeter } from "@/components/ui/seat-meter";
import { AppShell } from "@/components/app-shell/app-shell";
import { shellData } from "@/components/app-shell/shell-data";
import { PublicBar } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";
import { publicLeaguePreview } from "@/league-service/browse";
import { returnFromSignIn } from "@/league-service/join";
import { ENFORCEMENT_REFUSALS } from "@/league-service/enforcement";
import { SeatHoldPanel } from "@/league-room/components/seat-hold-panel";
import { SeatTakenPanel } from "@/league-room/components/seat-taken-panel";
import { HOUSE_RUNG_LABEL, type HouseRungName } from "@/matchmaking/house-catalog";
import { SEAT_HOLD_COOKIE } from "@/matchmaking/seat-hold";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly leagueId: string }>;
}

/** This page's own path — its `PublicBar`'s sign-in link and its interstitial's `SignInLink` both
 *  return here (Task 16, F6), and it is the `returnTo` WorkOS seals into the callback's state. */
function pageIntent(leagueId: string): string {
  return `/join/${leagueId}/hold`;
}

/** The race loser's two real actions (Task 6 Step 4, F15) — computed here, once, and handed to
 *  `SeatTakenPanel` as props, never built by the panel itself. A house league's next open edition
 *  is always the shelf on `/browse` (the factory's own guarantee, Task 13); a member league has
 *  no "next edition" to name, so both actions point a visitor at the same honest place: the open
 *  leagues closest to filling right now. */
function seatTakenActions(houseRung: HouseRungName | null) {
  return {
    primaryAction: (
      <Link href="/browse" className="text-sm font-medium text-accent underline">
        {houseRung === null ? "Browse open leagues" : `Join the next ${HOUSE_RUNG_LABEL[houseRung]} league`}
      </Link>
    ),
    secondaryAction: (
      <Link href="/browse" className="text-sm font-medium text-accent underline">
        See leagues closest to filling
      </Link>
    ),
  };
}

/**
 * The seat hold's own four screens (Task 6 Step 4), all on one route: `/join/[leagueId]/hold`.
 *
 * **Signed out — the interstitial.** The league's own facts, a live seat count, and
 * `SeatHoldPanel` — which claims the hold itself and renders the countdown plus `SignInLink`
 * (`intent={pageIntent(leagueId)}`), so the visitor who signs in comes back to this exact URL.
 *
 * **Signed in — "the return" (F4).** Reads the hold cookie and calls `returnFromSignIn`. Three
 * outcomes: (a) seated — redirected straight to the waiting room, the first thing anyone should
 * see after signing in for a seat being the seat itself; (b) seated anyway, the hold having run
 * out while a seat stayed open — redirected the same way (the one line naming that is the waiting
 * room's own hero, Task 9 Step 2b); (c) no seat at all — `SeatTakenPanel`, never a dead end. A
 * tier-blocked return is kept distinct from (c): a visitor turned away for who they are is owed
 * the real reason, not a shrug.
 */
export default async function SeatHoldPage({ params }: PageProps) {
  const { leagueId } = await params;
  const user = await getCurrentUser();

  if (user === null) {
    const preview = await publicLeaguePreview(getDb(), leagueId);
    if (preview === null) notFound();

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

  const jar = await cookies();
  const holdToken = jar.get(SEAT_HOLD_COOKIE)?.value ?? null;
  const result = await returnFromSignIn(getDb(), { leagueId, userId: user.id, holdToken, now: new Date().toISOString() });

  if (result.ok) {
    // Task 9 Step 2b (D1) computes the just-seated hero straight off `teams.created_at` — this
    // redirect carries no flag for THAT outcome, because it is already true the instant the row
    // this call just wrote exists. `holdExpired=1` is the one signal this handoff DOES carry: no
    // stored fact distinguishes "seated via a hold that had run out" from an ordinary walk-in
    // once the row exists, so Task 9's own "your ten minutes ran out ... we put you in it anyway"
    // line (Step 4, outcome b) has nothing else to key on. Inert until Task 9 reads it.
    redirect(result.expiredHold ? `/app/leagues/${leagueId}?holdExpired=1` : `/app/leagues/${leagueId}`);
  }

  const { rail, liveState } = await shellData(getDb(), user);
  const shellUser = { displayName: user.displayName, avatar: user.avatarUrl, isAdmin: user.isAdmin };

  if (result.reason === ENFORCEMENT_REFUSALS.join) {
    return (
      <AppShell user={shellUser} rail={rail} liveState={liveState}>
        <StatePanel
          tone="neutral"
          icon="shield"
          title="This league is not open to you"
          description={ENFORCEMENT_REFUSALS.join}
          action={
            <Link href="/browse" className="text-sm font-medium text-accent underline">
              Browse open leagues
            </Link>
          }
        />
      </AppShell>
    );
  }

  const preview = await publicLeaguePreview(getDb(), leagueId);
  const leagueName = preview?.name ?? "That league";
  const { primaryAction, secondaryAction } = seatTakenActions(preview?.houseRung ?? null);

  return (
    <AppShell user={shellUser} rail={rail} liveState={liveState}>
      <SeatTakenPanel leagueName={leagueName} primaryAction={primaryAction} secondaryAction={secondaryAction} />
    </AppShell>
  );
}
