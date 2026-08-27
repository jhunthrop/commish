"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { InviteBody } from "../contract";
import { Button, Input, Panel, Skeleton } from "@/components/ui";
import { useLeagueRoomDeps } from "../hooks/deps";

const CONNECTION_FAILED_MESSAGE = "We could not reach the server. Check your connection and try again.";

/** How long the "Copied" confirmation holds before the button reverts to "Copy link" — long
 *  enough to read, short enough that pressing it twice in a row still means something. */
const COPY_CONFIRMATION_MS = 2000;

function mailtoHref(invite: InviteBody, leagueName: string): string {
  const subject = leagueName === "" ? "Join my league on Commish" : `Join ${leagueName} on Commish`;
  const body = `You're invited to join ${leagueName === "" ? "my league" : leagueName} on Commish. Tap the link to join: ${invite.url}`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * One live invite: the absolute URL (flow analysis C-01 — never the bare `path`, which is not a
 * link that opens outside the app), a one-tap copy with a "Copied" confirmation, a share
 * affordance, and a revoke control (C-03). Extracted from `InvitePanel` so the panel's own render
 * stays a plain list-or-empty-state, not a wall of JSX for one invite's five controls.
 */
function LiveInvite({
  invite,
  leagueName,
  canShare,
  onShare,
  onRevoke,
  revoking,
}: {
  readonly invite: InviteBody;
  readonly leagueName: string;
  readonly canShare: boolean;
  readonly onShare: (invite: InviteBody) => void;
  readonly onRevoke: (code: string) => void;
  readonly revoking: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(invite.url);
    setCopied(true);
    setTimeout(() => setCopied(false), COPY_CONFIRMATION_MS);
  };

  const openSeatsRemaining = invite.maxUses - invite.uses;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line p-3">
      <Input label="Invite link" value={invite.url} readOnly />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy link"}
        </Button>
        {canShare ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => onShare(invite)}>
            Share
          </Button>
        ) : (
          <a href={mailtoHref(invite, leagueName)} className="inline-flex items-center rounded-pill border border-edge px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-surface-elevated">
            Email invite
          </a>
        )}
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => onRevoke(invite.code)}
          loading={revoking}
          disabled={revoking}
        >
          Revoke
        </Button>
      </div>
      <p role="status" className="text-sm text-text-muted">
        {`Or share the code `}
        <span className="font-mono font-semibold text-text-primary">{invite.code}</span>
        {`. Good for ${openSeatsRemaining} more ${openSeatsRemaining === 1 ? "person" : "people"}, until ${new Date(invite.expiresAt).toLocaleDateString()}.`}
      </p>
    </div>
  );
}

/**
 * The commissioner's way to actually get people in (flow analysis C-01/C-03/C-04).
 *
 * Persists across a reload: loads the league's own LIVE invites on mount (`GET`, C-03) rather
 * than starting from empty local state, so a commissioner who navigates away and back sees the
 * code they already sent — never a panel that quietly forgot it and offered to mint a second
 * one. Minting is still one press away when no live invite exists, and "Create another" is its
 * own, separately labelled action once one does, so a duplicate code is never a silent side
 * effect of the first press.
 */
export function InvitePanel({ leagueId, leagueName = "" }: { readonly leagueId: string; readonly leagueName?: string }) {
  const { fetchJson } = useLeagueRoomDeps();
  const [invites, setInvites] = useState<readonly InviteBody[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [revokingCode, setRevokingCode] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);

  // `navigator.share` is undefined during server rendering — checked in an effect so the first
  // client render matches the server's (mailto), then upgrades once mounted, rather than risking
  // a hydration mismatch on a value the server can never know.
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/leagues/${leagueId}/invites`);
      const body = (await response.json()) as ApiEnvelope<{ readonly invites: readonly InviteBody[] }>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      // Merged onto the empty default rather than trusted whole (the same discipline
      // `ModerationSummary`'s own `load` holds): a test double's fixture envelope, or any future
      // caller, may not carry `invites` at all — this renders the empty-state button instead of
      // crashing on `undefined.length`.
      setInvites(body.data.invites ?? []);
    } catch {
      setError(CONNECTION_FAILED_MESSAGE);
    } finally {
      setLoading(false);
    }
  }, [fetchJson, leagueId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (): Promise<void> => {
    setCreating(true);
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
      setInvites((current) => [body.data, ...current]);
    } catch {
      setError(CONNECTION_FAILED_MESSAGE);
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (code: string): Promise<void> => {
    setRevokingCode(code);
    setError(null);
    try {
      const response = await fetchJson(`/api/leagues/${leagueId}/invites`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await response.json()) as ApiEnvelope<{ readonly code: string }>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      setInvites((current) => current.filter((invite) => invite.code !== code));
    } catch {
      setError(CONNECTION_FAILED_MESSAGE);
    } finally {
      setRevokingCode(null);
    }
  };

  const share = (invite: InviteBody): void => {
    void navigator.share({
      title: leagueName === "" ? "Join my league on Commish" : `Join ${leagueName} on Commish`,
      text: leagueName === "" ? "You're invited to join my league on Commish." : `You're invited to join ${leagueName} on Commish.`,
      url: invite.url,
    });
  };

  return (
    <Panel title="Invite managers">
      {loading ? (
        <Skeleton lines={2} />
      ) : invites.length === 0 ? (
        <Button onClick={() => void create()} loading={creating} disabled={creating}>
          Create invite link
        </Button>
      ) : (
        <div className="flex flex-col gap-3">
          {invites.map((invite) => (
            <LiveInvite
              key={invite.code}
              invite={invite}
              leagueName={leagueName}
              canShare={canShare}
              onShare={share}
              onRevoke={(code) => void revoke(code)}
              revoking={revokingCode === invite.code}
            />
          ))}
          {/* A deliberate second code, never a silent one (flow analysis C-03): pressing this is
              the only way this panel ever mints a duplicate live invite. */}
          <Button type="button" variant="ghost" size="sm" onClick={() => void create()} loading={creating} disabled={creating} className="w-fit">
            Create another link
          </Button>
        </div>
      )}
      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </Panel>
  );
}
