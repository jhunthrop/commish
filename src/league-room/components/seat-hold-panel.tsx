"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ApiEnvelope } from "@/lib/api/respond";
import { ErrorState, Panel, Skeleton, buttonClassName } from "@/components/ui";
import { Countdown, formatCoarseDuration, useCountdown } from "@/components/ui/countdown";
import { SignInLink } from "@/components/app-shell/sign-in-link";
import type { SeatHoldBody } from "../contract";
import { useLeagueRoomDeps } from "../hooks/deps";

type ClaimState =
  | { readonly status: "claiming" }
  | { readonly status: "error"; readonly reason: string }
  | { readonly status: "held"; readonly expiresAt: string };

export interface SeatHoldPanelProps {
  readonly leagueId: string;
  readonly leagueName: string;
}

/**
 * The interstitial (Task 6 Step 4): a visitor's own seat, ten minutes, and the way in. Claims a
 * hold on mount — `POST /api/public/leagues/[leagueId]/hold` — so the seat this visitor is about
 * to sign in for is reserved for the whole trip to WorkOS and back, never merely hoped-for. A
 * CLIENT component on purpose: the claim is a write, and a Server Component's render cannot set
 * the cookie the write depends on — the same reason `JoinForm`'s own preview fetch is a client
 * effect rather than a server read.
 *
 * The countdown is display only, exactly as `Countdown`'s own docblock requires: the server's
 * `expiresAt` is what decides, and this panel never re-derives "is it still live" from the
 * ticking digits — a clock that ran out on screen simply stops showing digits a visitor can act
 * on; "the return" (`/join/[leagueId]/hold`'s signed-in branch) is what re-checks with the server.
 *
 * The way in is `SignInLink` (the addendum's Task 16), never a hand-written
 * `<Link href="/sign-in">` — that link is exactly what would drop this visitor's intent on the
 * floor and land them on `/app` with a held seat they can no longer see.
 */
export function SeatHoldPanel({ leagueId, leagueName }: SeatHoldPanelProps) {
  const { fetchJson } = useLeagueRoomDeps();
  const [claim, setClaim] = useState<ClaimState>({ status: "claiming" });

  useEffect(() => {
    let cancelled = false;
    setClaim({ status: "claiming" });

    (async (): Promise<void> => {
      try {
        const response = await fetchJson(`/api/public/leagues/${leagueId}/hold`, { method: "POST" });
        const body = (await response.json()) as ApiEnvelope<SeatHoldBody>;
        if (cancelled) return;
        setClaim(body.ok ? { status: "held", expiresAt: body.data.expiresAt } : { status: "error", reason: body.error });
      } catch {
        if (!cancelled) {
          setClaim({ status: "error", reason: "We could not reach the server. Check your connection and try again." });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueId, fetchJson]);

  const { remainingMs } = useCountdown(claim.status === "held" ? claim.expiresAt : null);

  if (claim.status === "claiming") {
    return <Skeleton lines={3} />;
  }

  if (claim.status === "error") {
    return (
      <ErrorState
        title="We could not hold that seat"
        description={claim.reason}
        action={
          <Link href="/browse" className="text-sm font-medium text-accent underline">
            Browse open leagues
          </Link>
        }
      />
    );
  }

  // Unreachable in practice: `claim.status === "held"` always carries an `expiresAt`, and the
  // clock has always snapped (`useNow`'s hydration contract) by the time the claim fetch — an
  // effect declared BEFORE the hook's own — has resolved. The server render never gets here at
  // all (`claim` starts as "claiming", the Skeleton branch above).
  if (remainingMs === null) return null;

  return (
    <Panel title={leagueName} meta="Seat held">
      <p className="text-sm text-text-muted">{`We are holding a seat for you in ${leagueName} while you sign in.`}</p>
      <div className="flex flex-col items-center gap-1 py-2">
        <Countdown remainingMs={remainingMs} size="xl" data-testid="seat-hold-countdown" />
        <p role="status" className="text-sm text-text-muted">{`Your hold expires in ${formatCoarseDuration(remainingMs)}.`}</p>
        {/* Gauntlet fix wave, item 11 (JF-H4): C3's safety-net sentence, quoted verbatim, reaching
            the join flow's own first screen — the hold page is where a first-timer first asks
            "what if I miss it", and until now the sentence rendered nowhere earlier than a
            full sit-and-go room or a missed draft, both well past this point. */}
        <p className="text-sm text-text-muted">The room picks for you from your queue if your clock runs out.</p>
      </div>
      {/* The hold page's ONE action (rule 5), so it is the view's ink pill. */}
      <SignInLink
        intent={`/join/${leagueId}/hold`}
        aria-label={`Sign in to finish joining ${leagueName}`}
        className={buttonClassName("primary", "md", "w-full")}
      >
        Sign in to finish joining
      </SignInLink>
    </Panel>
  );
}
