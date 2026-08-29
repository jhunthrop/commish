"use client";

import { useState } from "react";
import { Button, Modal } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import { useLeagueRoomDeps } from "../hooks/deps";

export interface ReleaseSeatControlProps {
  readonly leagueId: string;
  readonly leagueName: string;
  /**
   * F12: the control's whole visual weight is DERIVED from this, never stored and never a nudge
   * of its own. Zero on every league that has never rolled — every `when_full` league, by
   * construction (`DraftScheduleBody.kickoffRolls`'s own docblock), so the waiting room's own
   * caller always renders the quiet variant. `DraftSchedulePanel`'s `'scheduled'`-trigger league
   * escalates it from the first roll onward.
   */
  readonly kickoffRolls: number;
  /** Fires once the release actually lands — the caller's own team is gone at that point, so
   *  this is the one moment a parent may want to stop rendering the room around this control
   *  (e.g. navigate away). Optional: this control already shows its own confirmation either way. */
  readonly onReleased?: () => void;
}

/**
 * The escape hatch the roll requires (Phase 3.6, Task 8): a member who is waiting on a room that
 * keeps not filling must be able to leave, or "roll until full" is a room with the door welded
 * shut. Lives in the waiting room and on league home while the draft is `'scheduled'` — the two
 * surfaces `WaitingRoom` and `DraftSchedulePanel` render for exactly that state.
 *
 * At zero rolls this is a quiet text control, because nothing has gone wrong yet and offering the
 * door first is the product doubting its own league. From the first roll onward it takes a
 * visible secondary `Button`, because a member who has been moved is the member this control was
 * built for. The escalation is a derived rendering of `kickoffRolls`, a column that already
 * exists — never a stored state of its own.
 *
 * Sits behind a `Modal` confirm that states the consequence in the league's own terms, verbatim
 * (Step 4): destructive `Button` variant, keyboard-operable, focus returns to the opener on
 * cancel — all of which `Modal` already guarantees.
 */
export function ReleaseSeatControl({ leagueId, leagueName, kickoffRolls, onReleased }: ReleaseSeatControlProps) {
  const { fetchJson } = useLeagueRoomDeps();
  const [confirming, setConfirming] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [released, setReleased] = useState(false);

  const release = async (): Promise<void> => {
    setReleasing(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/leagues/${leagueId}/seat`, { method: "DELETE" });
      const body = (await response.json()) as ApiEnvelope<{ readonly released: true }>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      setConfirming(false);
      setReleased(true);
      onReleased?.();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setReleasing(false);
    }
  };

  if (released) {
    return <p className="text-sm text-text-muted">You released your seat in {leagueName}. Someone else can take it now.</p>;
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {kickoffRolls === 0 ? (
          <button type="button" className="text-sm text-text-muted underline" onClick={() => setConfirming(true)}>
            Release your seat
          </button>
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={() => setConfirming(true)}>
            Release your seat
          </Button>
        )}
      </div>
      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
      <Modal
        open={confirming}
        title="Release your seat?"
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={releasing}>
              Cancel
            </Button>
            <Button variant="destructive" loading={releasing} disabled={releasing} onClick={() => void release()}>
              Release seat
            </Button>
          </>
        }
      >
        <p>{`You will lose your seat in ${leagueName}. Someone else can take it right away, and the league may fill without you.`}</p>
      </Modal>
    </div>
  );
}
