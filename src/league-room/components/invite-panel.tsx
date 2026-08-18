"use client";

import { useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { InviteBody } from "../contract";
import { Button, Input } from "@/components/ui";
import { useLeagueRoomDeps } from "../hooks/deps";

/**
 * The commissioner's way to actually get people in. One button, then a link and a short code
 * — the same artifact, because the code IS the link's last segment. The read-only input is
 * there so the link can be selected and copied with the keyboard on every platform, rather
 * than depending on a clipboard permission.
 */
export function InvitePanel({ leagueId }: { readonly leagueId: string }) {
  const { fetchJson } = useLeagueRoomDeps();
  const [invite, setInvite] = useState<InviteBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const create = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/leagues/${leagueId}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await response.json()) as ApiEnvelope<InviteBody>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      setInvite(body.data);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-text-muted">Invite managers</h2>
      {invite === null ? (
        <Button onClick={() => void create()} loading={submitting} disabled={submitting}>
          Create invite link
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <Input label="Invite link" value={invite.path} readOnly />
          <p className="text-sm text-text-muted">
            Or share the code <span className="font-mono font-semibold text-text-primary">{invite.code}</span>.
            {` Good for up to ${invite.maxUses} people, until ${new Date(invite.expiresAt).toLocaleDateString()}.`}
          </p>
        </div>
      )}
      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </section>
  );
}
