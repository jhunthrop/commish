"use client";

import { useState } from "react";
import { Button, Input, Textarea } from "@/components/ui";
import { formatOrdinal } from "@/domain/format";
import type { ApiEnvelope } from "@/lib/api/respond";
import { formatUsd } from "@/money/config";
import { useAdminRoomDeps } from "../hooks/deps";
import { ConfirmModal } from "./confirm-modal";

interface SettleLeagueBody {
  readonly leagueId: string;
  readonly alreadySettled: boolean;
  readonly prizesPaidCents: number;
  readonly heldCents: number;
  readonly rakeCents: number;
}

interface SettlePreviewRosterEntry {
  readonly userId: string;
  readonly teamName: string;
  readonly ownerDisplayName: string;
}

interface SettlePreviewBody {
  readonly leagueId: string;
  readonly leagueName: string;
  readonly seasonCompleted: boolean;
  readonly entryFeeCents: number;
  readonly prizeTable: readonly { readonly place: number; readonly amountCents: number }[];
  readonly escrowCents: number;
  readonly roster: readonly SettlePreviewRosterEntry[];
}

interface SettleStanding {
  readonly place: number;
  readonly userId: string;
}

interface SettleConfirmRow extends SettleStanding {
  readonly amountCents: number;
  readonly displayName: string;
  /** `false` when the pasted id matched nobody on this league's own roster — the confirm still
   *  shows it, verbatim, rather than silently dropping a line the operator typed. */
  readonly knownMember: boolean;
}

interface SettleConfirmState {
  readonly leagueId: string;
  readonly leagueName: string;
  readonly escrowCents: number;
  readonly rows: readonly SettleConfirmRow[];
  /** Wave-1 review Q7: the preview's own fetched facts, carried through to the confirm body
   *  rather than fetched and then dropped — an operator settling early (the season is not over
   *  yet) is a different, riskier act than settling a finished one, and the fee is what the
   *  escrow figure above it is actually made of. */
  readonly seasonCompleted: boolean;
  readonly entryFeeCents: number;
}

function parseStandings(text: string): readonly SettleStanding[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((userId, index) => ({ place: index + 1, userId }));
}

function buildConfirmRows(standings: readonly SettleStanding[], preview: SettlePreviewBody): readonly SettleConfirmRow[] {
  const rosterByUserId = new Map(preview.roster.map((row) => [row.userId, row]));
  const prizeByPlace = new Map(preview.prizeTable.map((entry) => [entry.place, entry.amountCents]));
  return standings.map((standing) => {
    const member = rosterByUserId.get(standing.userId);
    return {
      ...standing,
      amountCents: prizeByPlace.get(standing.place) ?? 0,
      displayName: member === undefined ? standing.userId : `${member.ownerDisplayName} (${member.teamName})`,
      knownMember: member !== undefined,
    };
  });
}

/**
 * The admin-room settlement control (Phase 4, Task 10; read-then-confirm added per the operator
 * review, 2026-08-27, findings D1/D3): the season's end game. Pressing the button — or Enter in
 * either field — no longer fires the one-way `POST` directly: it fetches `GET /api/admin/leagues/
 * [leagueId]/settle`, a plain read that names the league, its published prize table, its escrow
 * and every seated member, and opens `ConfirmModal` with the operator's OWN pasted standings
 * resolved against that roster — a name and a dollar amount beside every place, not a textarea of
 * bare ids. A pasted id the roster does not recognize still renders, verbatim, so a typo is
 * visible before it is irreversible rather than silently swallowed.
 */
export function SettleLeagueControl() {
  const { fetchJson } = useAdminRoomDeps();
  const [leagueId, setLeagueId] = useState("");
  const [standingsText, setStandingsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState<SettleConfirmState | null>(null);
  const [settled, setSettled] = useState<SettleLeagueBody | null>(null);

  const beginConfirm = async (): Promise<void> => {
    const trimmed = leagueId.trim();
    if (trimmed.length === 0) {
      setError("Enter the league's id.");
      return;
    }
    const standings = parseStandings(standingsText);
    setPreviewing(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/admin/leagues/${trimmed}/settle`);
      const envelope = (await response.json()) as ApiEnvelope<SettlePreviewBody>;
      if (!envelope.ok) {
        setError(envelope.error);
        return;
      }
      setConfirming({
        leagueId: trimmed,
        leagueName: envelope.data.leagueName,
        escrowCents: envelope.data.escrowCents,
        rows: buildConfirmRows(standings, envelope.data),
        seasonCompleted: envelope.data.seasonCompleted,
        entryFeeCents: envelope.data.entryFeeCents,
      });
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
      const response = await fetchJson(`/api/admin/leagues/${confirming.leagueId}/settle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ standings: confirming.rows.map(({ place, userId }) => ({ place, userId })) }),
      });
      const envelope = (await response.json()) as ApiEnvelope<SettleLeagueBody>;
      if (!envelope.ok) {
        setError(envelope.error);
        setConfirming(null);
        return;
      }
      setSettled(envelope.data);
      setLeagueId("");
      setStandingsText("");
      setConfirming(null);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
      setConfirming(null);
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
        void beginConfirm();
      }}
    >
      {/* SUBTRACTION (Sunday v5): this hint was `OperatorTool`'s own `intent` line restated on
          the field below it, and a league id field needs no explanation of what settlement does.
          The standings field keeps its hint, which teaches a real input format nothing else on
          the page states. */}
      <Input
        label="League id"
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
        <Button type="submit" loading={previewing} disabled={previewing || submitting}>
          Settle league
        </Button>
      </div>

      {confirming === null ? null : (
        <ConfirmModal
          open
          title={`Settle ${confirming.leagueName}?`}
          body={
            <div className="flex flex-col gap-2">
              <p>Pay {confirming.leagueName}&apos;s prize table and close its escrow. This cannot be undone.</p>
              <p className="text-sm">
                {confirming.seasonCompleted
                  ? "Season complete."
                  : "Season not yet complete. Settling now closes its escrow early."}{" "}
                Entry fee: {formatUsd(confirming.entryFeeCents)}.
              </p>
              {confirming.rows.length === 0 ? (
                <p className="text-sm">No standings were entered. No prize will be paid.</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {confirming.rows.map((row) => (
                    <li key={row.place}>
                      {formatOrdinal(row.place)}: {row.displayName}
                      {row.knownMember ? null : " (not on this league's roster)"}, {formatUsd(row.amountCents)}
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-sm">Escrow closing: {formatUsd(confirming.escrowCents)}.</p>
            </div>
          }
          confirmLabel={`Settle ${confirming.leagueName}`}
          variant="destructive"
          busy={submitting}
          onCancel={() => setConfirming(null)}
          onConfirm={() => void submit()}
        />
      )}
    </form>
  );
}
