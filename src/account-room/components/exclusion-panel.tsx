"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal, Panel } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import { useAccountRoomDeps } from "../hooks/deps";

interface SetExclusionBody {
  readonly selfExcludedAt: string;
}

/** Plain, readable, no raw ISO string reaching the page. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export interface ExclusionPanelProps {
  /** `walletAccountFlags(db, userId).selfExcludedAt`, computed server-side and handed down. */
  readonly selfExcludedAt: string | null;
}

/**
 * The self-exclusion door's own panel (Task 12) — a supportive one-way door, never an
 * accusatory one. Once excluded, this panel is a plain statement of fact with no action: the
 * member's own "I closed this" stays one-way (`setSelfExclusion`'s own docblock), and only an
 * operator, from a support conversation, clears it (`ExclusionControl`, the admin room).
 *
 * The initiating button is the QUIET pill (`variant="secondary"`), never the page's ink action —
 * this is a serious, deliberate choice, not a celebratory one. A REAL confirm step
 * (`Modal`, focus-trapped, `Escape` closes) stands between the button and the request: nothing is
 * posted until the reader explicitly confirms a second time, in words that repeat exactly what is
 * about to happen.
 */
export function ExclusionPanel({ selfExcludedAt }: ExclusionPanelProps) {
  const router = useRouter();
  const { fetchJson } = useAccountRoomDeps();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const confirm = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson("/api/wallet/exclusion", { method: "POST" });
      const envelope = (await response.json()) as ApiEnvelope<SetExclusionBody>;
      if (!envelope.ok) {
        setError(envelope.error);
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (selfExcludedAt !== null) {
    return (
      <Panel title="Paid play">
        <p className="text-sm text-text-primary">
          You closed paid play on this account on {formatDate(selfExcludedAt)}. Nothing about your leagues or your free play changes, and only support can
          reopen it.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Paid play">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-muted">
          If you want to stop paid play on this account, you can close it below. This is a one-way door: once closed, only support can reopen it. Free
          play is never affected.
        </p>
        <div>
          <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
            Close paid play on this account
          </Button>
        </div>
      </div>

      <Modal
        open={confirmOpen}
        title="Close paid play on this account?"
        onClose={() => {
          setConfirmOpen(false);
          setError(null);
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmOpen(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" loading={submitting} disabled={submitting} onClick={() => void confirm()}>
              Yes, close paid play
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-primary">Once closed, only support can reopen it. Nothing about your leagues or your free play changes.</p>
          {error === null ? null : (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </Panel>
  );
}
