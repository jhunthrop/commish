"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import { formatUsd } from "@/money/config";
import { useAdminRoomDeps } from "../hooks/deps";

interface HoldOutcomeBody {
  readonly userId: string;
  readonly action: "release" | "confiscate";
  readonly amountCents: number;
}

/**
 * The admin-room held-payout panel (Phase 4, Task 10): the two one-way exits from
 * `held_for_review`, in `ExclusionControl`'s own paste-an-id shape — an operator arrives from the
 * flag they just resolved, which names the member. Release when the flag closed in the member's
 * favor; confiscate when it closed against them. Both are one press and one-way: the first
 * outcome drains the hold, and a second press answers the plain "nothing held" refusal.
 */
export function HoldsControl() {
  const { fetchJson } = useAdminRoomDeps();
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<HoldOutcomeBody | null>(null);

  const submit = async (action: "release" | "confiscate"): Promise<void> => {
    const trimmed = userId.trim();
    if (trimmed.length === 0) {
      setError("Enter the member's user id.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/admin/holds/${trimmed}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const envelope = (await response.json()) as ApiEnvelope<HoldOutcomeBody>;
      if (!envelope.ok) {
        setError(envelope.error);
        return;
      }
      setOutcome(envelope.data);
      setUserId("");
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
        void submit("release");
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
        <Button type="submit" loading={submitting} disabled={submitting}>
          Release hold
        </Button>
        <Button type="button" variant="destructive" disabled={submitting} onClick={() => void submit("confiscate")}>
          Confiscate hold
        </Button>
      </div>
    </form>
  );
}
