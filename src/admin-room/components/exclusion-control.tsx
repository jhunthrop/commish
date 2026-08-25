"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import { useAdminRoomDeps } from "../hooks/deps";

/**
 * The admin-room self-exclusion clear control (Task 7 Step 2, the brief's own words: "only an
 * operator can clear it, from the admin room, audited as admin_action"). Calls
 * `DELETE /api/wallet/exclusion` — the same route file the member's own `POST` lives on
 * (`src/app/api/wallet/exclusion/route.ts`'s own docblock explains why one file carries both
 * directions).
 *
 * An operator pastes a user id rather than searching for one: the fuller responsible-gaming
 * surface (a member lookup, limits, cool-offs) is Phase 8 scope by the plan's own ruling. This is
 * the narrow, correct-today shape — a support conversation ends with an operator who already has
 * the member's id from that conversation, typing it here.
 */
export function ExclusionControl() {
  const { fetchJson } = useAdminRoomDeps();
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [clearedFor, setClearedFor] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const trimmed = userId.trim();
    if (trimmed.length === 0) {
      setError("Enter the member's user id.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson("/api/wallet/exclusion", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: trimmed }),
      });
      const envelope = (await response.json()) as ApiEnvelope<{ readonly userId: string }>;
      if (!envelope.ok) {
        setError(envelope.error);
        return;
      }
      setClearedFor(envelope.data.userId);
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
        void submit();
      }}
    >
      <Input
        label="Member user id"
        hint="Paid play stays closed for this account until you clear it here."
        value={userId}
        onChange={(event) => {
          setUserId(event.target.value);
          setClearedFor(null);
        }}
      />

      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}

      {clearedFor === null ? null : (
        <p role="status" className="text-sm text-positive">
          Paid play is open again for this account. No other member account is affected.
        </p>
      )}

      <div>
        <Button type="submit" loading={submitting} disabled={submitting}>
          Clear self exclusion
        </Button>
      </div>
    </form>
  );
}
