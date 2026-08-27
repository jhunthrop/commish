"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import { formatUsd } from "@/money/config";
import { useAdminRoomDeps } from "../hooks/deps";
import { ConfirmModal } from "./confirm-modal";

interface HoldOutcomeBody {
  readonly userId: string;
  readonly action: "release" | "confiscate";
  readonly amountCents: number;
}

interface HoldPreviewBody {
  readonly userId: string;
  readonly displayName: string;
  readonly heldCents: number;
}

interface HoldConfirmState extends HoldPreviewBody {
  readonly action: "release" | "confiscate";
}

/**
 * The admin-room held-payout panel (Phase 4, Task 10; read-then-confirm added per the operator
 * review, 2026-08-27, findings D1/D3): the two one-way exits from `held_for_review`. Neither
 * button fires its `POST` directly any more — each first fetches `GET /api/admin/holds/[userId]`,
 * a plain read that names the member and the exact amount held, and opens `ConfirmModal` naming
 * that member and that amount. Release's confirm stays the page's one quiet ink (`variant`
 * defaults to `"primary"`); confiscate's confirm stays `"destructive"` — the SAME visual
 * distinction the two trigger buttons already carried, now carried into the moment that actually
 * moves the money, restated in words ("takes the member's balance") rather than color alone.
 */
export function HoldsControl() {
  const { fetchJson } = useAdminRoomDeps();
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState<HoldConfirmState | null>(null);
  const [outcome, setOutcome] = useState<HoldOutcomeBody | null>(null);

  const beginConfirm = async (action: "release" | "confiscate"): Promise<void> => {
    const trimmed = userId.trim();
    if (trimmed.length === 0) {
      setError("Enter the member's user id.");
      return;
    }
    setPreviewing(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/admin/holds/${trimmed}`);
      const envelope = (await response.json()) as ApiEnvelope<HoldPreviewBody>;
      if (!envelope.ok) {
        setError(envelope.error);
        return;
      }
      if (envelope.data.heldCents <= 0) {
        setError("Nothing is held for this member.");
        return;
      }
      setConfirming({ ...envelope.data, action });
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
      const response = await fetchJson(`/api/admin/holds/${confirming.userId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: confirming.action }),
      });
      const envelope = (await response.json()) as ApiEnvelope<HoldOutcomeBody>;
      if (!envelope.ok) {
        setError(envelope.error);
        setConfirming(null);
        return;
      }
      setOutcome(envelope.data);
      setUserId("");
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
        void beginConfirm("release");
      }}
    >
      <Input
        label="Member id"
        hint="Applies to the member's whole held balance. Release pays it to their wallet; confiscate forfeits it to the platform."
        value={userId}
        onChange={(event) => {
          setUserId(event.target.value);
          setOutcome(null);
        }}
      />

      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}

      {outcome === null ? null : (
        <p role="status" className="text-sm text-positive">
          {outcome.action === "release"
            ? `${formatUsd(outcome.amountCents)} released to the member's wallet.`
            : `${formatUsd(outcome.amountCents)} confiscated to the platform.`}
        </p>
      )}

      <div className="flex gap-3">
        {/* Wave-1 review Q8: while `ConfirmModal` is open, its OWN confirm button is the view's
            one ink action (`ConfirmModal`'s own docblock, Sunday Standard rule 5) — these two
            triggers step down to the quiet pill for as long as it is, so the page never shows
            two loud buttons at once, and step back to their ordinary color the moment it closes. */}
        <Button type="submit" variant={confirming === null ? "primary" : "secondary"} loading={previewing && confirming === null} disabled={previewing || submitting}>
          Release hold
        </Button>
        <Button
          type="button"
          variant={confirming === null ? "destructive" : "secondary"}
          disabled={previewing || submitting}
          onClick={() => void beginConfirm("confiscate")}
        >
          Confiscate hold
        </Button>
      </div>

      {confirming === null ? null : (
        <ConfirmModal
          open
          title={confirming.action === "release" ? `Release hold for ${confirming.displayName}?` : `Confiscate hold for ${confirming.displayName}?`}
          body={
            <p>
              {confirming.action === "release"
                ? `Pay ${formatUsd(confirming.heldCents)} to ${confirming.displayName}'s wallet. This cannot be undone.`
                : `Take ${formatUsd(confirming.heldCents)} from ${confirming.displayName}'s balance. This cannot be undone.`}
            </p>
          }
          confirmLabel={confirming.action === "release" ? `Release ${confirming.displayName}'s hold` : `Confiscate ${confirming.displayName}'s hold`}
          variant={confirming.action === "release" ? "primary" : "destructive"}
          busy={submitting}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void submit()}
        />
      )}
    </form>
  );
}
