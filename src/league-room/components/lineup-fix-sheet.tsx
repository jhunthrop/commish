"use client";

import { useState } from "react";
import { Button, PositionBadge } from "@/components/ui";
import { DecisionSheet } from "@/components/ui/decision-sheet";
import type { RosterSlotConfig } from "@research/domain/roster";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { LineupBody } from "../contract";
import { useLeagueRoomDeps } from "../hooks/deps";
import { formatPoints } from "../lib/format";
import { slotLabelFor, startersWithFix, type LineupCandidate, type LineupFixPlan } from "../lib/lineup-problems";
import { PlayerName } from "./player-peek";

export interface LineupFixSheetProps {
  readonly leagueId: string;
  readonly weekNumber: number;
  readonly lineup: LineupBody;
  readonly rosterSlots: readonly RosterSlotConfig[];
  readonly plan: LineupFixPlan;
  readonly onClose: () => void;
  /** Called after a successful commit — the shell refreshes the server data and closes. */
  readonly onFixed: () => void;
}

const REASON_META: Readonly<Record<LineupFixPlan["problem"]["reason"], (name: string | null) => string>> = {
  empty: () => "The slot is empty for Sunday",
  bye: (name) => `${name ?? "Your starter"} is on bye this week`,
  out: (name) => `${name ?? "Your starter"} is ruled out`,
};

const BASELINE_WORD: Readonly<Record<LineupFixPlan["problem"]["reason"], string>> = {
  empty: "an empty slot",
  bye: "a player on bye",
  out: "a player ruled out",
};

function evidence(candidate: LineupCandidate): string {
  const parts: string[] = [];
  if (candidate.projection !== null) parts.push(`Projects ${candidate.projection.toFixed(1)} this week`);
  if (candidate.fixture !== null) parts.push(`plays ${candidate.fixture.when} ${candidate.fixture.opp}`);
  if (candidate.projection === null && candidate.adp !== null) parts.push(`ADP ${Math.round(candidate.adp)}`);
  return parts.join(" · ");
}

/**
 * THE LINEUP FIX — law 3's first sheet. The room already diagnosed the slot, ranked the bench
 * and priced each option (`lineup-problems.ts`); this sheet states the recommendation with its
 * evidence, the alternatives one line each, and the projected-total delta before anything
 * commits. One amber verb per candidate; esc backs out; the commit goes through the same
 * lineup endpoint the team page uses.
 */
export function LineupFixSheet({ leagueId, weekNumber, lineup, rosterSlots, plan, onClose, onFixed }: LineupFixSheetProps) {
  const { fetchJson } = useLeagueRoomDeps();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const commit = async (candidate: LineupCandidate): Promise<void> => {
    if (busyId !== null) return;
    setBusyId(candidate.playerId);
    setError(null);
    try {
      const response = await fetchJson(`/api/leagues/${leagueId}/teams/me/lineup`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekNumber, slots: startersWithFix(lineup, plan.problem, candidate.playerId) }),
      });
      const body = (await response.json()) as ApiEnvelope<unknown>;
      if (!body.ok) {
        setError(body.error);
        setBusyId(null);
        return;
      }
      onFixed();
    } catch {
      setError("The change did not go through. Try again.");
      setBusyId(null);
    }
  };

  const recommended = plan.candidates[0] ?? null;
  const alternatives = plan.candidates.slice(1, 4);
  const baseline = BASELINE_WORD[plan.problem.reason];

  return (
    <DecisionSheet
      open
      title={`Fix your ${slotLabelFor(plan.problem, rosterSlots)}`}
      meta={REASON_META[plan.problem.reason](plan.problem.playerName)}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busyId !== null}>
            Back
          </Button>
          <span className="ml-auto text-xs text-text-faint">
            nothing is final until you pick · lineups lock at kickoff
          </span>
        </>
      }
    >
      {recommended === null ? (
        <p className="text-sm text-text-muted">
          No bench player fits this slot right now. The players drawer has free agents who do.
        </p>
      ) : (
        <div className="accent-wash flex items-center gap-3 rounded-md p-3 ring-2 ring-accent/40">
          <PositionBadge position={recommended.position} size="md" />
          <div className="flex min-w-0 flex-col">
            <p className="font-display text-md font-semibold text-text-primary">
              Start{" "}
              <PlayerName leagueId={leagueId} playerId={recommended.playerId} name={recommended.playerName} className="inline" />
            </p>
            <p className="text-sm text-text-muted">{evidence(recommended)}</p>
          </div>
          <div className="ml-auto flex shrink-0 flex-col items-end gap-1.5">
            {recommended.delta === null ? null : (
              <p className="font-mono text-sm font-medium text-positive">
                +{recommended.delta.toFixed(1)} over {baseline}
              </p>
            )}
            <Button variant="verb" size="sm" loading={busyId === recommended.playerId} onClick={() => void commit(recommended)}>
              Start {recommended.playerName.split(" ").slice(-1)[0]}
            </Button>
          </div>
        </div>
      )}

      {alternatives.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-text-faint">Or from your bench</p>
          {alternatives.map((candidate) => (
            <div key={candidate.playerId} className="flex items-center gap-3 rounded-md bg-surface-raised px-3 py-2 shadow-raised">
              <PositionBadge position={candidate.position} size="sm" />
              <PlayerName
                leagueId={leagueId}
                playerId={candidate.playerId}
                name={candidate.playerName}
                className="min-w-0 truncate font-display text-sm font-semibold text-text-primary"
              />
              <p className="min-w-0 truncate text-xs text-text-muted">{evidence(candidate)}</p>
              <Button
                variant="secondary"
                size="sm"
                className="ml-auto shrink-0"
                loading={busyId === candidate.playerId}
                onClick={() => void commit(candidate)}
              >
                Start
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {plan.totalBefore !== null && plan.totalAfter !== null ? (
        <p className="border-t border-line pt-2 font-mono text-sm text-text-muted">
          Your projected total: <span className="text-text-faint">{formatPoints(plan.totalBefore)}</span>{" "}
          <span aria-hidden>→</span>{" "}
          <span className="font-medium text-positive">{formatPoints(plan.totalAfter)}</span>
          <span className="sr-only">after the recommended start</span>
        </p>
      ) : null}

      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </DecisionSheet>
  );
}
