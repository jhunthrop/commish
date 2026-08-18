"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { JoinBody } from "../contract";
import { Button } from "@/components/ui";
import { useLeagueRoomDeps } from "../hooks/deps";

/** The landing page for a shared invite link. One decision, one button, one clear outcome. */
export function JoinForm({ code }: { readonly code: string }) {
  const { fetchJson } = useLeagueRoomDeps();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const join = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/invites/${code}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await response.json()) as ApiEnvelope<JoinBody>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      router.push(`/app/leagues/${body.data.leagueId}`);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-text-primary">
        {"You've been invited to a league. Invite code "}
        <span className="font-mono font-semibold">{code}</span>.
      </p>
      <Button onClick={() => void join()} loading={submitting} disabled={submitting}>
        Join this league
      </Button>
      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
