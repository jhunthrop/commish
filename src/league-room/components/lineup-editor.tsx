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
export function LineupEditor({ leagueId, lineup }: { readonly leagueId: string; readonly lineup: LineupBody }) {
  const { fetchJson } = useLeagueRoomDeps();
  const [assignments, setAssignments] = useState<Readonly<Record<string, string | null>>>(
    () => Object.fromEntries(lineup.starters.map((slot) => [slotKey(slot), slot.playerId])),
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const everyone = useMemo(() => [...lineup.starters, ...lineup.bench].filter((slot) => slot.playerId !== null), [lineup]);

  if (lineup.locked) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-text-primary">{`${formatWeek(lineup.weekNumber)} lineup`}</h2>
        <p className="text-sm text-text-muted">{`${formatWeek(lineup.weekNumber)} has started, so its lineup can't change.`}</p>
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
