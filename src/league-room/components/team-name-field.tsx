"use client";

import { useState, type FormEvent } from "react";
import { Button, Input } from "@/components/ui";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { TeamNameBody } from "../contract";
import { useLeagueRoomDeps } from "../hooks/deps";

export interface TeamNameFieldProps {
  readonly leagueId: string;
  /** The name this manager's team carries right now, server-read. */
  readonly initialName: string;
  /**
   * `LEAGUE_CONFIG.maxNameLength`, THREADED from the server page (fix round 1, MEDIUM 6). The
   * client boundary forbids a value import of `@/league` from a room directory, so the one
   * constant `renameMyTeamSchema` already enforces travels as a prop rather than being retyped
   * here — the same threading `CreateSheetDefaults` does for the service's own defaults. Without
   * it an over-length name only failed on the round trip, which is a refusal the field could have
   * made before the manager finished typing.
   */
  readonly maxLength: number;
}

/**
 * A MANAGER NAMES THEIR OWN TEAM (2026-09-11), on the My team page, which is where a manager
 * already goes to change something about their team.
 *
 * This is the control the waiting room's "Team name" panel never had. That panel stated the name
 * a seat was given and offered nothing to do about it, which is an instruction with no verb, and
 * the signed-in home's Sideline redesign deleted it along with the other three standing panels.
 * The fact and the control live together now: the field shows the stored name and the one button
 * beside it writes it.
 *
 * Props in, `fetchJson` for the write only, state updated from the response rather than re-
 * fetched — the same shape `SlotPreferencePanel` beside it keeps. The confirmation says the name
 * it saved, because a save that does not name what it saved is a save you have to go and check.
 */
export function TeamNameField({ leagueId, initialName, maxLength }: TeamNameFieldProps) {
  const deps = useLeagueRoomDeps();
  const [name, setName] = useState(initialName);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const response = await deps.fetchJson(`/api/leagues/${leagueId}/team-name`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const envelope = (await response.json()) as ApiEnvelope<TeamNameBody>;
      if (!envelope.ok) {
        setError(envelope.error);
        return;
      }
      // The STORED name, not the typed one: the schema trims, so the field shows what the room
      // will actually call this manager all season.
      setName(envelope.data.name);
      setSaved(envelope.data.name);
    } catch {
      setError("That did not save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2" aria-label="Name your team">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          label="Team name"
          value={name}
          maxLength={maxLength}
          error={error ?? undefined}
          onChange={(event) => {
            setName(event.target.value);
            setSaved(null);
          }}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="secondary" loading={saving} disabled={name.trim().length === 0}>
          Save
        </Button>
      </div>
      {saved === null ? null : (
        <p role="status" className="text-sm text-text-muted">
          {`Saved. The room calls you ${saved} now.`}
        </p>
      )}
    </form>
  );
}
