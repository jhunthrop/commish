"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import { formatUsd } from "@/money/config";
import { useAdminRoomDeps } from "../hooks/deps";

interface DissolveLeagueBody {
  readonly leagueId: string;
  readonly refundedMembers: number;
  readonly totalRefundedCents: number;
}

/**
 * The admin-room dissolution control (Phase 4, Task 9, brief's own words: "operator-triggered,
 * pre-draft only, every fee refunded, every member told"). Calls `POST /api/admin/leagues/
 * [leagueId]/dissolve`, `ExclusionControl`'s own shape (`./exclusion-control.tsx`): an operator
 * pastes a league id rather than searching for one, on the identical reasoning — the fuller
 * league-lookup surface is later scope, and a support conversation that ends in "close this
 * league" already has the id from that conversation.
 *
 * No confirmation dialog beyond the button's own label: `dissolveLeague`'s guarded `UPDATE`
 * makes a second press against an already-dissolved league answer the plain "draft already
 * started" refusal rather than double-refund anyone, so the worst a mis-click costs is one
 * honest error message, not a second payout.
 */
export function DissolveLeagueControl() {
  const { fetchJson } = useAdminRoomDeps();
  const [leagueId, setLeagueId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dissolved, setDissolved] = useState<DissolveLeagueBody | null>(null);

  const submit = async (): Promise<void> => {
    const trimmed = leagueId.trim();
    if (trimmed.length === 0) {
      setError("Enter the league's id.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/admin/leagues/${trimmed}/dissolve`, { method: "POST" });
      const envelope = (await response.json()) as ApiEnvelope<DissolveLeagueBody>;
      if (!envelope.ok) {
        setError(envelope.error);
        return;
      }
      setDissolved(envelope.data);
      setLeagueId("");
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Input
        label="League id"
        hint="Closes the league for good, before its draft, and refunds every seated member."
        value={leagueId}
        onChange={(event) => {
          setLeagueId(event.target.value);
          setDissolved(null);
        }}
      />

      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}

      {dissolved === null ? null : (
        <p role="status" className="text-sm text-positive">
          {dissolved.refundedMembers === 0
            ? "This league is dissolved. It had no seated members to refund."
            : dissolved.totalRefundedCents > 0
              ? `This league is dissolved. ${dissolved.refundedMembers} member(s) were refunded ${formatUsd(dissolved.totalRefundedCents)} in total.`
              : `This league is dissolved. ${dissolved.refundedMembers} member(s) were notified; there was no fee to refund.`}
        </p>
      )}

      <div>
        <Button type="submit" loading={submitting} disabled={submitting}>
          Dissolve league
        </Button>
      </div>
    </form>
  );
}
