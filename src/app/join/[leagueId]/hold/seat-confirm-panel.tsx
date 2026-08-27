"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ApiEnvelope } from "@/lib/api/respond";
import { ErrorState, Panel, buttonClassName } from "@/components/ui";
import { StatePanel } from "@/components/ui/state-panel";
import { SeatTakenPanel } from "@/league-room/components/seat-taken-panel";
import { HOUSE_RUNG_LABEL, type HouseRungName } from "@/matchmaking/house-catalog";
import { useLeagueRoomDeps } from "@/league-room/hooks/deps";
import type { SeatConfirmBody } from "./contract";

export interface SeatConfirmPanelProps {
  readonly leagueId: string;
  readonly leagueName: string;
  /** The race loser's own next destination (Task 6 Step 4, F15) — read once, server-side, off
   *  the SAME `publicLeaguePreview` row the page's own read-only render already fetched. */
  readonly houseRung: HouseRungName | null;
}

type ConfirmState =
  | { readonly status: "idle" | "confirming" }
  | { readonly status: "network-error"; readonly reason: string }
  | { readonly status: "tier-blocked"; readonly reason: string }
  | { readonly status: "seat-taken" };

/**
 * A1 (2026-08-27 flow analysis, finding 1 — "a GET request permanently joins you to a league").
 * The hold page's signed-in return used to seat a member as a side effect of RENDERING: a bare
 * GET wrote a `teams` row, no confirm, no exit. The write now lives entirely behind this panel's
 * own POST (`./confirm/route.ts`), triggered by the visitor's own tap — never by navigation, a
 * prefetch, or a crawler. `page.tsx`'s signed-in branch is a pure read; this is the whole of what
 * moved.
 *
 * Mirrors `SeatHoldPanel`'s own shape (a local state machine over one `fetchJson` call, the same
 * dependency-injected `useLeagueRoomDeps` every league-room write goes through) rather than
 * inventing a second write pattern for the one screen either side of sign-in shares.
 */
export function SeatConfirmPanel({ leagueId, leagueName, houseRung }: SeatConfirmPanelProps) {
  const { fetchJson } = useLeagueRoomDeps();
  const router = useRouter();
  const [state, setState] = useState<ConfirmState>({ status: "idle" });

  async function confirm(): Promise<void> {
    setState({ status: "confirming" });
    try {
      const response = await fetchJson(`/join/${leagueId}/hold/confirm`, { method: "POST" });
      const body = (await response.json()) as ApiEnvelope<SeatConfirmBody>;
      if (!body.ok) {
        setState({ status: "network-error", reason: body.error });
        return;
      }
      if (body.data.outcome === "seated") {
        // Task 9 Step 2b: the same just-seated hero a fresh join always lands on, hold or no
        // hold — the ONE signal the redirect carries, unchanged from the render-time write this
        // replaces.
        router.push(body.data.holdExpired ? `/app/leagues/${leagueId}?holdExpired=1` : `/app/leagues/${leagueId}`);
        return;
      }
      if (body.data.outcome === "tier_blocked") {
        setState({ status: "tier-blocked", reason: body.data.reason ?? "" });
        return;
      }
      setState({ status: "seat-taken" });
    } catch {
      setState({ status: "network-error", reason: "We could not reach the server. Check your connection and try again." });
    }
  }

  if (state.status === "tier-blocked") {
    return (
      <StatePanel
        tone="neutral"
        icon="shield"
        title="This league is not open to you"
        description={state.reason}
        action={
          <Link href="/browse" className="text-sm font-medium text-accent underline">
            Browse open leagues
          </Link>
        }
      />
    );
  }

  if (state.status === "seat-taken") {
    return (
      <SeatTakenPanel
        leagueName={leagueName}
        primaryAction={
          <Link href="/browse" className="text-sm font-medium text-accent underline">
            {houseRung === null ? "Browse open leagues" : `Join the next ${HOUSE_RUNG_LABEL[houseRung]} league`}
          </Link>
        }
        secondaryAction={
          <Link href="/browse" className="text-sm font-medium text-accent underline">
            See leagues closest to filling
          </Link>
        }
      />
    );
  }

  if (state.status === "network-error") {
    return (
      <ErrorState
        title="We could not confirm your seat"
        description={state.reason}
        action={
          <button type="button" onClick={() => void confirm()} className={buttonClassName("primary", "md")}>
            Try again
          </button>
        }
      />
    );
  }

  return (
    <Panel title={leagueName} meta="Ready to join">
      <p className="text-sm text-text-muted">{`Confirm your seat in ${leagueName}.`}</p>
      <button
        type="button"
        onClick={() => void confirm()}
        disabled={state.status === "confirming"}
        aria-label={`Take your seat in ${leagueName}`}
        className={buttonClassName("primary", "md", "w-full")}
      >
        {state.status === "confirming" ? "Taking your seat…" : `Take your seat in ${leagueName}`}
      </button>
    </Panel>
  );
}
