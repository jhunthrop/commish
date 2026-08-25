"use client";

import { useState } from "react";
import { Button, Input, Textarea } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import { formatUsd } from "@/money/config";
import { useAdminRoomDeps } from "../hooks/deps";

interface SettleLeagueBody {
  readonly leagueId: string;
  readonly alreadySettled: boolean;
  readonly prizesPaidCents: number;
  readonly heldCents: number;
  readonly rakeCents: number;
}

/**
 * The admin-room settlement control (Phase 4, Task 10): the season's end game, in
 * `DissolveLeagueControl`'s own paste-an-id shape (`./dissolve-league-control.tsx`) — an operator
 * arrives from the season-close checklist that already names the league. The standings go in as
 * one member id per line, top line first place: WHO finished where is the ONLY thing this form
 * can say, because the request schema has no amount field at all — every dollar figure is the
 * league's own stored payout table, read server-side under lock.
 *
 * No confirmation dialog beyond the button's own label: `settleSeasonPayouts` answers a repeat
 * as a clean idempotent no-op, so the worst a mis-click costs is the "already settled" sentence.
 */
export function SettleLeagueControl() {
  const { fetchJson } = useAdminRoomDeps();
  const [leagueId, setLeagueId] = useState("");
  const [standingsText, setStandingsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [settled, setSettled] = useState<SettleLeagueBody | null>(null);

  const submit = async (): Promise<void> => {
    const trimmed = leagueId.trim();
    if (trimmed.length === 0) {
      setError("Enter the league's id.");
      return;
    }
    const standings = standingsText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((userId, index) => ({ place: index + 1, userId }));
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/admin/leagues/${trimmed}/settle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ standings }),
      });
      const envelope = (await response.json()) as ApiEnvelope<SettleLeagueBody>;
      if (!envelope.ok) {
        setError(envelope.error);
        return;
      }
      setSettled(envelope.data);
      setLeagueId("");
      setStandingsText("");
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const outcome = (body: SettleLeagueBody): string => {
    if (body.alreadySettled) return "This league was already settled. No money moved.";
    const parts = [`${formatUsd(body.prizesPaidCents)} paid to winners`];
    if (body.heldCents > 0) parts.push(`${formatUsd(body.heldCents)} held for review`);
    parts.push(`${formatUsd(body.rakeCents)} platform fee collected`);
    return `This league is settled. ${parts.join(", ")}. The escrow is closed at zero.`;
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
        label="League id"
        hint="Pays the league's published prize table and closes its escrow."
        value={leagueId}
        onChange={(event) => {
          setLeagueId(event.target.value);
          setSettled(null);
        }}
      />
      <Textarea
        label="Final standings"
        hint="One member id per line. The top line is 1st place. Amounts come from the league's own prize table."
        value={standingsText}
        onChange={(event) => {
          setStandingsText(event.target.value);
          setSettled(null);
        }}
      />

      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}

      {settled === null ? null : (
        <p role="status" className="text-sm text-positive">
          {outcome(settled)}
        </p>
      )}

      <div>
        <Button type="submit" loading={submitting} disabled={submitting}>
          Settle league
        </Button>
      </div>
    </form>
  );
}
