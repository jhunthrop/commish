"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import { formatUsd } from "@/money/config";
import { useAdminRoomDeps } from "../hooks/deps";
import { ConfirmModal } from "./confirm-modal";

interface DissolveLeagueBody {
  readonly leagueId: string;
  readonly refundedMembers: number;
  readonly totalRefundedCents: number;
}

interface DissolvePreviewBody {
  readonly leagueId: string;
  readonly leagueName: string;
  readonly seatedCount: number;
}

/**
 * The admin-room dissolution control (Phase 4, Task 9; read-then-confirm added per the operator
 * review, 2026-08-27, findings D1/D3): "operator-triggered, pre-draft only, every fee refunded,
 * every member told". Pressing the button — or Enter in the id field — no longer fires the
 * one-way `POST` directly: it fetches `GET /api/admin/leagues/[leagueId]/dissolve`, a plain read
 * that names the league and its seated count, and opens `ConfirmModal` with that name IN the
 * question ("Dissolve The Blitz Room?") and the consequence stated as a fact. Only the modal's
 * own button fires the mutation. An empty field still short-circuits before any request at all —
 * the review's own "zero non-GET requests" proof now reads "zero requests, full stop".
 */
export function DissolveLeagueControl() {
  const { fetchJson } = useAdminRoomDeps();
  const [leagueId, setLeagueId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState<DissolvePreviewBody | null>(null);
  const [dissolved, setDissolved] = useState<DissolveLeagueBody | null>(null);

  const beginConfirm = async (): Promise<void> => {
    const trimmed = leagueId.trim();
    if (trimmed.length === 0) {
      setError("Enter the league's id.");
      return;
    }
    setPreviewing(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/admin/leagues/${trimmed}/dissolve`);
      const envelope = (await response.json()) as ApiEnvelope<DissolvePreviewBody>;
      if (!envelope.ok) {
        setError(envelope.error);
        return;
      }
      setConfirming(envelope.data);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setPreviewing(false);
    }
  };

  const submit = async (): Promise<void> => {
    if (confirming === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/admin/leagues/${confirming.leagueId}/dissolve`, { method: "POST" });
      const envelope = (await response.json()) as ApiEnvelope<DissolveLeagueBody>;
      if (!envelope.ok) {
        setError(envelope.error);
        setConfirming(null);
        return;
      }
      setDissolved(envelope.data);
      setLeagueId("");
      setConfirming(null);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
      setConfirming(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void beginConfirm();
      }}
    >
      {/* SUBTRACTION (Sunday v5): the hint restated `OperatorTool`'s own `intent` line — closed
          before its draft, every seated member refunded — and carried exactly one fact the
          intent did not, that it cannot be undone. That fact moved up into the intent, where
          the reader meets it before the field rather than beneath it. */}
      <Input
        label="League id"
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
              ? `This league is dissolved. It refunded ${formatUsd(dissolved.totalRefundedCents)} to ${dissolved.refundedMembers} ${dissolved.refundedMembers === 1 ? "member" : "members"} in total.`
              : `This league is dissolved. It notified ${dissolved.refundedMembers} ${dissolved.refundedMembers === 1 ? "member" : "members"}; there was no fee to refund.`}
        </p>
      )}

      <div>
        <Button type="submit" loading={previewing} disabled={previewing || submitting}>
          Dissolve league
        </Button>
      </div>

      {confirming === null ? null : (
        <ConfirmModal
          open
          title={`Dissolve ${confirming.leagueName}?`}
          body={
            <p>
              {confirming.seatedCount === 0
                ? `This closes ${confirming.leagueName} for good. Nobody is seated, so nothing is refunded. This cannot be undone.`
                : `This closes ${confirming.leagueName} for good and refunds its ${confirming.seatedCount} seated ${confirming.seatedCount === 1 ? "member" : "members"}. This cannot be undone.`}
            </p>
          }
          confirmLabel={`Dissolve ${confirming.leagueName}`}
          variant="destructive"
          busy={submitting}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void submit()}
        />
      )}
    </form>
  );
}
