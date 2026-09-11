"use client";

import { useState } from "react";
import { Button, PlayerRow } from "@/components/ui";
import { DecisionSheet } from "@/components/ui/decision-sheet";
import type { FreeAgentRow } from "@/league-service/claims-contract";
import type { ApiEnvelope } from "@/lib/api/respond";
import { useLeagueRoomDeps } from "../hooks/deps";
import type { DropCandidate } from "../lib/claim-drop";
import { formatWeekdayClock } from "../lib/format";

export interface ClaimSheetProps {
  readonly leagueId: string;
  readonly agent: FreeAgentRow;
  /** Worst first (`rankDropCandidates`) — the head is the pre-filled drop. */
  readonly dropCandidates: readonly DropCandidate[];
  /** With an open roster spot no drop is required, and the sheet says so. */
  readonly rosterFull: boolean;
  readonly onClose: () => void;
  /** Called after a successful claim — the shell refreshes the server data and closes. */
  readonly onClaimed: () => void;
}

type ClaimOutcome = { readonly ok: true; readonly added?: string; readonly waiverFiled?: true; readonly clearsAt?: string };

function candidateLine(candidate: DropCandidate): string {
  if (candidate.projection !== null) return `projects ${candidate.projection.toFixed(1)} this week`;
  if (candidate.adp !== null) return `ADP ${Math.round(candidate.adp)}`;
  return "no projection this week";
}

/**
 * THE CLAIM SHEET — law 3's third sheet. A claim's hidden cost is the drop, so the drop leads:
 * pre-filled with the viewer's lowest-projected bench player (`claim-drop.ts`), swappable by a
 * tap, with the waiver clear time stated before the one amber verb. Both success arms of the
 * claims endpoint render honestly: an immediate add, or a filed claim with its clear time.
 */
export function ClaimSheet({ leagueId, agent, dropCandidates, rosterFull, onClose, onClaimed }: ClaimSheetProps) {
  const { fetchJson } = useLeagueRoomDeps();
  const [dropId, setDropId] = useState<string | null>(rosterFull ? (dropCandidates[0]?.playerId ?? null) : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const onWaivers = agent.onWaiversUntil !== null && agent.onWaiversUntil !== undefined;

  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/leagues/${leagueId}/claims`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addPlayerId: agent.id, dropPlayerId: dropId }),
      });
      const body = (await response.json()) as ApiEnvelope<ClaimOutcome>;
      if (!body.ok) {
        setError(body.error);
        setBusy(false);
        return;
      }
      setOutcome(
        body.data.waiverFiled === true
          ? `Claim filed. It clears ${body.data.clearsAt === undefined ? "when the waiver window closes" : formatWeekdayClock(body.data.clearsAt)}.`
          : `${agent.name} is on your roster.`,
      );
      setBusy(false);
    } catch {
      setError("The claim did not go through. Try again.");
      setBusy(false);
    }
  };

  return (
    <DecisionSheet
      open
      title={`Claim ${agent.name}`}
      meta={onWaivers ? `on waivers · clears ${formatWeekdayClock(agent.onWaiversUntil ?? "")}` : "free agent · adds now"}
      onClose={onClose}
      footer={
        outcome !== null ? (
          <>
            <p className="text-sm text-text-primary">{outcome}</p>
            <Button variant="verb" size="sm" className="ml-auto" onClick={onClaimed}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
              Back
            </Button>
            <Button
              variant="verb"
              size="sm"
              className="ml-auto"
              loading={busy}
              disabled={rosterFull && dropId === null}
              onClick={() => void submit()}
            >
              {onWaivers ? "Submit claim" : "Add player"}
            </Button>
          </>
        )
      }
    >
      {rosterFull ? (
        // No semicolons, and no sentence whose only job is to explain the control under it (P7):
        // the radio group already says it is a choice, so the copy says only what the product did.
        <p className="text-sm text-text-muted">A claim needs a drop. Your lowest-projected bench player is picked.</p>
      ) : (
        <p className="text-sm text-text-muted">You have an open roster spot, so no drop is needed.</p>
      )}

      {dropCandidates.length === 0 && rosterFull ? (
        <p className="text-sm text-negative">Your bench is empty, so there is nobody to drop.</p>
      ) : (
        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Player to drop">
          {!rosterFull ? (
            <button
              type="button"
              role="radio"
              aria-checked={dropId === null}
              onClick={() => setDropId(null)}
              className={`flex min-h-12 items-center gap-3 rounded-md px-3 text-left ring-inset ${
                dropId === null ? "ring-2 ring-accent" : "bg-surface-raised hover:bg-surface"
              }`}
            >
              <span className="text-md text-text-primary">Keep everyone · use the open spot</span>
            </button>
          ) : null}
          {dropCandidates.map((candidate) => (
            // THE DROP IS A PERSON (P1), so the choice is a `PlayerRow` inside the radio rather
            // than a position chip beside a string. `PlayerFace` draws its own "we do not know"
            // fallback for a candidate the bench read carries no headshot for — never a
            // placeholder standing in for somebody else.
            <button
              key={candidate.playerId}
              type="button"
              role="radio"
              aria-checked={dropId === candidate.playerId}
              onClick={() => setDropId(candidate.playerId)}
              className={`rounded-md text-left ring-inset ${
                dropId === candidate.playerId ? "ring-2 ring-accent" : "bg-surface-raised"
              }`}
            >
              <PlayerRow
                dense
                player={{
                  id: candidate.playerId,
                  name: candidate.playerName,
                  position: candidate.position,
                  nflTeam: candidate.nflTeam ?? "",
                  headshotUrl: null,
                  adp: candidate.adp,
                }}
                name={`Drop ${candidate.playerName}`}
                meta={candidateLine(candidate)}
              />
            </button>
          ))}
        </div>
      )}

      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </DecisionSheet>
  );
}
