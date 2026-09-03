"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import { useAdminRoomDeps } from "../hooks/deps";

export interface JobRerunControlProps {
  readonly jobId: number;
}

/**
 * The jobs page's one action: enqueue a fresh copy of a terminal job
 * (`POST /api/admin/jobs/rerun`). History is never rewritten — the dead-lettered row stays as it
 * ended and a new job appears in the queue, which is why success refreshes the page rather than
 * mutating anything client-side. Fetches through `useAdminRoomDeps` like every admin-room
 * control, so tests hand in a fake and never touch the network.
 */
export function JobRerunControl({ jobId }: JobRerunControlProps) {
  const { fetchJson } = useAdminRoomDeps();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson("/api/admin/jobs/rerun", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const envelope = (await response.json()) as ApiEnvelope<{ readonly newJobId: number }>;
      if (!envelope.ok) {
        setError(envelope.error);
        return;
      }
      router.refresh();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" loading={submitting} onClick={() => void submit()}>
        Run again
      </Button>
      {error === null ? null : (
        <p role="alert" className="text-xs text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
