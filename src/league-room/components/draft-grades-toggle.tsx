"use client";

import { useCallback, useState } from "react";
import { Button, Card } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { LeagueSettingsBody } from "../contract";
import { useLeagueRoomDeps } from "../hooks/deps";

export interface DraftGradesToggleProps {
  readonly leagueId: string;
  readonly visible: boolean;
}

const CONNECTION_FAILED_MESSAGE = "We could not reach the server. Check your connection and try again.";
const ON_DESCRIPTION = "Every manager sees the letter grades on league home once the draft ends.";
const OFF_DESCRIPTION = "Grades stay off league home. Nobody in this league sees them.";

/**
 * THE COMMISSIONER'S OWN CONTROL over `leagues.draft_grades_visible` (Task 10) — the one league
 * setting this task ships, mounted in the rail beside `ModerationSummary` (the same
 * commissioner-only gate `RoomShell` already applies to that card). The click flips the button's
 * own state immediately (a write this cheap needs no loading skeleton) and rolls it back if the
 * server refuses or the request fails, so the button never shows a state the database disagrees
 * with for longer than one round trip.
 */
export function DraftGradesToggle({ leagueId, visible: initialVisible }: DraftGradesToggleProps) {
  const { fetchJson } = useLeagueRoomDeps();
  const [visible, setVisible] = useState(initialVisible);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = useCallback(async (): Promise<void> => {
    const next = !visible;
    setPending(true);
    setError(null);
    setVisible(next);
    try {
      const response = await fetchJson(`/api/leagues/${leagueId}/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftGradesVisible: next }),
      });
      const envelope = (await response.json()) as ApiEnvelope<LeagueSettingsBody>;
      if (!envelope.ok) {
        setVisible(!next);
        setError(envelope.error);
        return;
      }
      setVisible(envelope.data.draftGradesVisible);
    } catch {
      setVisible(!next);
      setError(CONNECTION_FAILED_MESSAGE);
    } finally {
      setPending(false);
    }
  }, [fetchJson, leagueId, visible]);

  return (
    <Card as="section" aria-label="Draft grades setting" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-text-primary">Draft grades on league home</p>
        <Button type="button" variant="secondary" size="sm" aria-pressed={visible} disabled={pending} onClick={() => void toggle()}>
          {visible ? "On" : "Off"}
        </Button>
      </div>
      <p className="text-xs text-text-faint">{visible ? ON_DESCRIPTION : OFF_DESCRIPTION}</p>
      {error === null ? null : (
        <p role="alert" className="text-xs text-negative">
          {error}
        </p>
      )}
    </Card>
  );
}
