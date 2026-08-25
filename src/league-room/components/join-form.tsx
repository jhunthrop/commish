"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { LeagueTerms } from "@/league";
import { Button } from "@/components/ui";
import type { StateCode } from "@/money/states";
import { useLeagueRoomDeps } from "../hooks/deps";
import type { JoinBody } from "../contract";
import { PaidJoinConfirmation } from "./paid-join-confirmation";

/**
 * Duplicated from `@/league-service/join`'s own refusal constants (`LEAGUE_FULL`,
 * `DRAFT_ALREADY_STARTED`) and `@/league-service/enforcement`'s `ENFORCEMENT_REFUSALS.join` —
 * never imported, because `@/league-service` is blocked as a value import from
 * `src/league-room/**` (the client boundary, `eslint.config.mjs`'s `SERVER_ONLY_MODULE_GROUPS`),
 * the same reasoning `SCORING_LABEL_TERM`/`WHEN_FULL_FILLING_NOTE` (`@/league/terms.ts`) already
 * duplicate across for. Compared against `POST /api/invites/[code]/accept`'s own error string so
 * this form can route the three DIFFERENT terminal outcomes to `InviteLanding`'s matching state
 * instead of the generic inline alert every other failure still gets — see `onLeagueFull`,
 * `onDraftStarted` and `onTierRefused` below.
 *
 * `LEAGUE_FULL` IS reachable through `acceptInvite` today: `joinLeagueInTx`'s capacity check
 * (`@/league-service/join`) is unconditional, so an invite that fills between this page's own
 * SSR render and the click lands here for real. `DRAFT_ALREADY_STARTED` and `TIER_REFUSED` are
 * NOT — `invitePrecondition` (`@/league-service/invites`) checks only an invite's own expiry and
 * use count; the draft-status and tier gates belong to `publicJoinPrecondition`, the PUBLIC
 * BROWSE door's own precondition, and an invite accept never runs it. Both are still wired to
 * the real state and the real action A5 (Phase 3.6 addendum) requires, honestly rather than
 * silently, should the invite door ever grow the same checks the public one already has.
 */
const LEAGUE_FULL = "That league is already full.";
const DRAFT_ALREADY_STARTED = "That league's draft has already started. Try another open league.";
const TIER_REFUSED =
  "This league is reserved for newer players so everyone starts on a level footing. Browse the open leagues to find one you can join.";

export interface JoinFormProps {
  readonly code: string;
  /** Already known — `InviteLanding` fetched it once, server-side, before this ever mounts. This
   *  form reads only `terms.name` for its own button label; the rest of the terms are
   *  `LeagueTermsPanel`'s job, rendered once by `InviteLanding` regardless of session. */
  readonly terms: LeagueTerms;
  /**
   * Phase 4, Task 13: `PaidJoinConfirmation`'s own "balance after" sentence — computed and
   * `formatUsd`'d server-side (`walletSummary`, `@/money-service/read`, minus the league's own
   * `entryFeeCents`) by the page above `InviteLanding`, ONLY when `terms.entryFeeUsd` is defined
   * (never for a free join, which is every join this season). `undefined` for every free join and
   * for a signed-out render.
   */
  readonly balanceAfterUsd?: string;
  /** The accept succeeded, but this account already had a team here — no use spent, nothing
   *  written. `InviteLanding` shows "you are already in, here is the door" instead of a silent
   *  redirect. */
  readonly onAlreadyMember: (leagueId: string) => void;
  readonly onLeagueFull: () => void;
  readonly onDraftStarted: () => void;
  readonly onTierRefused: () => void;
}

/**
 * The invite landing's own action: one button, one request. `InviteLanding` (this component's
 * only caller) already fetched and rendered the terms before this ever mounts — this component's
 * whole job is the accept itself and what happens after.
 *
 * A brand new join goes straight to the league it just joined; the four terminal outcomes above
 * are reported upward instead, because each one replaces THIS SCREEN with a different one
 * (`SeatTakenPanel`, the "you are already in" panel, the tier refusal) rather than an inline
 * alert under a button that no longer makes sense to press again.
 */
export function JoinForm({
  code,
  terms,
  balanceAfterUsd,
  onAlreadyMember,
  onLeagueFull,
  onDraftStarted,
  onTierRefused,
}: JoinFormProps) {
  const { fetchJson } = useLeagueRoomDeps();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Phase 4, Task 13: the paid join's own state-of-entry attestation — the fee gate's own first
  // question (`moneyGates`, `@/money-service/gates`), asked here before "Join" ever attempts to
  // spend. `null` until chosen; `terms.entryFeeUsd === undefined` (every league today) never
  // reads this state at all.
  const [stateOfEntry, setStateOfEntry] = useState<StateCode | null>(null);
  const paid = terms.entryFeeUsd !== undefined;

  const join = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/invites/${code}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // `stateOfEntry` rides only a paid join's own request — a free join's body stays `{}`,
        // byte-identical to every join this season. The server-side wiring that reads this field
        // (`money-live task wires commissioner fee collection before the creation gate opens`)
        // is deliberately not this task's — see `JoinMoneyContext`'s own docblock
        // (`@/league-service/join`).
        body: JSON.stringify(paid && stateOfEntry !== null ? { stateOfEntry } : {}),
      });
      const body = (await response.json()) as ApiEnvelope<JoinBody>;
      if (!body.ok) {
        if (body.error === LEAGUE_FULL) {
          onLeagueFull();
          return;
        }
        if (body.error === DRAFT_ALREADY_STARTED) {
          onDraftStarted();
          return;
        }
        if (body.error === TIER_REFUSED) {
          onTierRefused();
          return;
        }
        // Every other refusal (a dead code that expired or ran out between this page's own SSR
        // render and this click, or an unexpected 500) keeps the plain inline alert — the visitor
        // already read the terms and pressed Join, and there is nothing to swap the screen for.
        setError(body.error);
        return;
      }
      if (body.data.alreadyMember) {
        onAlreadyMember(body.data.leagueId);
        return;
      }
      router.push(`/app/leagues/${body.data.leagueId}`);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Phase 4, Task 13: the paid join's own confirmation gates the button on a chosen state —
  // never a state the fee gate was never asked about. `balanceAfterUsd`'s own docblock says why
  // it is always defined alongside a `paid` terms object; the `?? ""` fallback below is a
  // type-level nicety that no real render exercises.
  return (
    <div className="flex flex-col gap-3">
      {paid ? (
        <PaidJoinConfirmation
          entryFeeUsd={terms.entryFeeUsd ?? ""}
          balanceAfterUsd={balanceAfterUsd ?? ""}
          stateOfEntry={stateOfEntry}
          onStateOfEntryChange={setStateOfEntry}
        />
      ) : null}
      <Button onClick={() => void join()} loading={submitting} disabled={submitting || (paid && stateOfEntry === null)}>
        {`Join ${terms.name}`}
      </Button>
      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
