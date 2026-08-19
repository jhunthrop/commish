"use client";

import { useMemo, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { LineupBody, LineupSlotView } from "../contract";
import { Button, Select, SlotChip } from "@/components/ui";
import { useLeagueRoomDeps } from "../hooks/deps";
import { formatWeek } from "../lib/format";

const slotKey = (slot: LineupSlotView): string => `${slot.slot}:${slot.slotIndex}`;

/**
 * Starters and bench for one week.
 *
 * It holds nothing but "which player is in which STARTING slot", and sends exactly that: the
 * server derives the bench and `validateLineup` decides legality, so no lineup arithmetic
 * happens in React — which it could not anyway, since this directory may not value-import
 * `@/league`. A rejection is shown in the server's own words.
 */
export function LineupEditor({
  leagueId,
  lineup,
  totalWeeks,
}: {
  readonly leagueId: string;
  readonly lineup: LineupBody;
  /** The season's last week number. Names the reopening condition in the locked message —
   *  "next week" only means something if there is one. */
  readonly totalWeeks: number;
}) {
  const { fetchJson } = useLeagueRoomDeps();
  const [assignments, setAssignments] = useState<Readonly<Record<string, string | null>>>(
    () => Object.fromEntries(lineup.starters.map((slot) => [slotKey(slot), slot.playerId])),
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const everyone = useMemo(() => [...lineup.starters, ...lineup.bench].filter((slot) => slot.playerId !== null), [lineup]);

  if (lineup.locked) {
    // Persona review (first-timer, FIX 4): stating the situation without naming what happens
    // next reads as a dead end. There IS a next step — it just isn't available yet — so say
    // when. The season's final week has no next week to point at, so the second sentence is
    // dropped rather than promising a lineup that will never open.
    const hasNextWeek = lineup.weekNumber < totalWeeks;
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-text-primary">{`${formatWeek(lineup.weekNumber)} lineup`}</h2>
        <p className="text-sm text-text-muted">
          {hasNextWeek
            ? `${formatWeek(lineup.weekNumber)} has started, so its lineup can't change. You can set next week's lineup as soon as this week ends.`
            : `${formatWeek(lineup.weekNumber)} has started, so its lineup can't change.`}
        </p>
        <ul className="flex flex-col gap-1">
          {lineup.starters.map((slot) => (
            <li key={slotKey(slot)} className="flex items-center gap-2 text-text-primary">
              <SlotChip slot={slot.slot} />
              <span>{slot.playerName ?? "Empty"}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const save = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetchJson(`/api/leagues/${leagueId}/teams/me/lineup`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          weekNumber: lineup.weekNumber,
          slots: lineup.starters.map((slot) => ({ slot: slot.slot, slotIndex: slot.slotIndex, playerId: assignments[slotKey(slot)] ?? null })),
        }),
      });
      const body = (await response.json()) as ApiEnvelope<LineupBody>;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      setSaved(true);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium text-text-primary">{`${formatWeek(lineup.weekNumber)} lineup`}</h2>
      {/* Persona review (veteran, FIX 5): the lock is coarse — the WHOLE week locks at the
          first kickoff, not each player at their own — and nothing said so before this. A
          manager who plans to swap a Monday-night player after watching Sunday's early games
          needs to know that plan won't work before they're locked out of trying it. */}
      <p className="text-sm text-text-muted">Lineups lock for the whole week when its first game kicks off.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {lineup.starters.map((slot) => (
          <Select
            key={slotKey(slot)}
            label={slot.slot}
            value={assignments[slotKey(slot)] ?? ""}
            options={[
              { value: "", label: "Empty" },
              ...everyone.map((option) => ({ value: option.playerId!, label: `${option.playerName} (${option.position})` })),
            ]}
            onChange={(event) =>
              setAssignments((prev) => ({ ...prev, [slotKey(slot)]: event.target.value === "" ? null : event.target.value }))
            }
          />
        ))}
      </div>
      <h3 className="text-sm font-medium text-text-muted">Bench</h3>
      <p className="text-sm text-text-muted">
        {lineup.bench.map((slot) => slot.playerName).filter((name) => name !== null).join(", ") || "Nobody on the bench."}
      </p>
      <Button onClick={() => void save()} loading={submitting} disabled={submitting}>
        Save lineup
      </Button>
      {saved ? (
        <p role="status" className="text-sm text-positive">
          Lineup saved.
        </p>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </section>
  );
}
