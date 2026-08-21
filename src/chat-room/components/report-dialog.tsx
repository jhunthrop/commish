"use client";

import { useState } from "react";
import { CHAT_CONFIG, type ChatReportReasonValue } from "@/chat/config";
import { Button, Modal } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import { useChatRoomDeps } from "../hooks/deps";

export interface ReportDialogProps {
  readonly open: boolean;
  readonly leagueId: string;
  /** `""` while nothing is being reported — `open` alone gates rendering (`Modal` renders
   *  nothing when `open` is false), so an empty id here is never sent. */
  readonly messageId: string;
  readonly onClose: () => void;
}

type Status = "idle" | "sending" | "sent" | "error";

/**
 * The reporter's own affordance, opened from `MessageList`'s per-message "Report" button. A
 * MODAL, not `ReviewFeed`'s inline disclosure (`src/account-room/components/review-feed.tsx`):
 * a chat room is a denser list than the review feed, and an inline reason picker on every row
 * would crowd the one surface this product asks to stay readable at 360px.
 *
 * Three reasons, the SAME closed set `reviews` reports pick from (`CHAT_CONFIG.reportReasons`,
 * re-exported from `@/moderation/config` — founder decision #2's default: one vocabulary, two
 * record types). Reporting is a SIGNAL, not an action (ruling 12) — this dialog never claims a
 * message was removed or even reviewed, only that the report reached the queue.
 */
export function ReportDialog({ open, leagueId, messageId, onClose }: ReportDialogProps) {
  const { fetchJson } = useChatRoomDeps();
  const [reason, setReason] = useState<ChatReportReasonValue>(CHAT_CONFIG.reportReasons[0]!.value);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setStatus("sending");
    setError(null);
    try {
      const response = await fetchJson(`/api/leagues/${leagueId}/chat/${messageId}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const envelope = (await response.json()) as ApiEnvelope<{ readonly reported: true }>;
      if (!envelope.ok) {
        setStatus("error");
        setError(envelope.error);
        return;
      }
      setStatus("sent");
    } catch {
      setStatus("error");
      setError("We couldn't reach the server. Check your connection and try again.");
    }
  };

  // Resets on the way out, so the next message reported opens on a clean reason and no stale
  // success/error state from whichever message was reported last.
  const handleClose = (): void => {
    setStatus("idle");
    setError(null);
    setReason(CHAT_CONFIG.reportReasons[0]!.value);
    onClose();
  };

  return (
    <Modal
      open={open}
      title="Report this message"
      onClose={handleClose}
      footer={
        status === "sent" ? (
          <Button onClick={handleClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button loading={status === "sending"} disabled={status === "sending"} onClick={() => void submit()}>
              Send report
            </Button>
          </>
        )
      }
    >
      {status === "sent" ? (
        <p>Reported. An operator will take a look. Thank you.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">
            Report messages that break the rules. Disagreeing with someone isn&apos;t a reason to report it.
          </p>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium text-text-primary">Reason</legend>
            {CHAT_CONFIG.reportReasons.map((entry) => (
              <label key={entry.value} className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="radio"
                  name="chat-report-reason"
                  value={entry.value}
                  checked={reason === entry.value}
                  onChange={() => setReason(entry.value)}
                  className="size-4 accent-accent"
                />
                {entry.label}
              </label>
            ))}
          </fieldset>
          {error === null ? null : (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
