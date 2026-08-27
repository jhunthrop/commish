"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import { useAdminRoomDeps } from "../hooks/deps";
import { ConfirmModal } from "./confirm-modal";

interface ExclusionPreviewBody {
  readonly userId: string;
  readonly displayName: string;
  readonly selfExcludedAt: string;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/**
 * The admin-room self-exclusion clear control (Task 7 Step 2; read-then-confirm added per the
 * operator review, 2026-08-27, findings D1/D3): "only an operator can clear it, from the admin
 * room, audited as admin_action". Pressing the button — or Enter in the id field — no longer
 * fires the one-way `DELETE` directly: it fetches `GET /api/wallet/exclusion?userId=…`, a plain
 * read that names the member and the date they excluded themselves, and opens `ConfirmModal`
 * with both facts. Only the modal's own button reopens paid play.
 */
export function ExclusionControl() {
  const { fetchJson } = useAdminRoomDeps();
  const [userId, setUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState<ExclusionPreviewBody | null>(null);
  const [clearedFor, setClearedFor] = useState<string | null>(null);

  const beginConfirm = async (): Promise<void> => {
    const trimmed = userId.trim();
    if (trimmed.length === 0) {
      setError("Enter the member's user id.");
      return;
    }
    setPreviewing(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/wallet/exclusion?userId=${encodeURIComponent(trimmed)}`);
      const envelope = (await response.json()) as ApiEnvelope<ExclusionPreviewBody>;
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
      const response = await fetchJson("/api/wallet/exclusion", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: confirming.userId }),
      });
      const envelope = (await response.json()) as ApiEnvelope<{ readonly userId: string }>;
      if (!envelope.ok) {
        setError(envelope.error);
        setConfirming(null);
        return;
      }
      setClearedFor(envelope.data.userId);
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
        void beginConfirm();
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
        <Button type="submit" loading={previewing} disabled={previewing || submitting}>
          Clear self exclusion
        </Button>
      </div>

      {confirming === null ? null : (
        <ConfirmModal
          open
          title={`Clear self exclusion for ${confirming.displayName}?`}
          body={
            <p>
              Paid play opens again for {confirming.displayName}, excluded since {formatWhen(confirming.selfExcludedAt)}. This cannot be undone.
            </p>
          }
          confirmLabel={`Clear exclusion for ${confirming.displayName}`}
          variant="destructive"
          busy={submitting}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void submit()}
        />
      )}
    </form>
  );
}
