"use client";

import { useMemo, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { LineupBody, LineupSlotView } from "../contract";
import { Button, InfoTip, Select, SlotChip } from "@/components/ui";
import type { HelpLevel } from "@/identity/preferences";
import { useLeagueRoomDeps } from "../hooks/deps";
import { formatWeek } from "../lib/format";
import { term } from "@/help/glossary";

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
  helpLevel,
}: {
  readonly leagueId: string;
  readonly lineup: LineupBody;
  /** The season's last week number. Names the reopening condition in the locked message —
   *  "next week" only means something if there is one. */
  readonly totalWeeks: number;
  /** Forwarded from `LeagueHome`. Omitted only by tests that don't care about this branch —
   *  `InfoTip` itself defaults to the click-only, non-inline behavior when it's absent. */
  readonly helpLevel?: HelpLevel;
}) {
  const { fetchJson } = useLeagueRoomDeps();
  const [assignments, setAssignments] = useState<Readonly<Record<string, string | null>>>(
    () => Object.fromEntries(lineup.starters.map((slot) => [slotKey(slot), slot.playerId])),
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const everyone = useMemo(() => [...lineup.starters, ...lineup.bench].filter((slot) => slot.playerId !== null), [lineup]);
  // A per-league override could drop FLEX from the roster entirely — the caption only prints
  // when the slot it explains is actually on the page, same reasoning as GLOSSARY omitting
  // `waiver` for a feature the product doesn't have.
  const hasFlexSlot = lineup.starters.some((slot) => slot.slot === "FLEX");
  // SUPERFLEX (Task 1): only a superflex league's lineup ever has this slot, so the caption is
  // just as conditional as FLEX's own — and carries an InfoTip, since "a flex spot that also
  // takes a quarterback" is a newer word than FLEX and worth the click-to-learn-more.
  const hasSuperflexSlot = lineup.starters.some((slot) => slot.slot === "SUPERFLEX");

  // League-life review D2 (2026-08-27): a league whose draft has not run has NOTHING on any
  // roster — and the locked branch below told that first-timer "Week 1 has started, so its
  // lineup cannot change" over nine Empty rows. Week 1 had not started; the slots were empty
  // because nobody had drafted. A rosterless lineup is exactly the pre-draft state (a drafted
  // team always holds players), so it gets the honest sentence and no scaffold at all.
  const rosterless = [...lineup.starters, ...lineup.bench].every((slot) => slot.playerId === null);
  if (rosterless) {
    return (
      <section id="lineup" className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-text-primary">{`${formatWeek(lineup.weekNumber)} lineup`}</h2>
        <p className="text-sm text-text-muted">Your lineup appears here after the draft.</p>
      </section>
    );
  }

  if (lineup.locked) {
    // Persona review (first-timer, FIX 4): stating the situation without naming what happens
    // next reads as a dead end. There IS a next step — it just isn't available yet — so say
    // when. The season's final week has no next week to point at, so the second sentence is
    // dropped rather than promising a lineup that will never open.
    const hasNextWeek = lineup.weekNumber < totalWeeks;
    return (
      // `id="lineup"` (F16): a real anchor on a real panel, in BOTH branches — the locked state
      // is still where `/app/leagues/${id}#lineup` has to land, not just the editable one.
      <section id="lineup" className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-text-primary">{`${formatWeek(lineup.weekNumber)} lineup`}</h2>
        <p className="text-sm text-text-muted">
          {hasNextWeek
            ? `${formatWeek(lineup.weekNumber)} has started, so its lineup cannot change. You can set next week's lineup as soon as this week ends.`
            : `${formatWeek(lineup.weekNumber)} has started, so its lineup cannot change.`}
        </p>
        <ul className="flex flex-col gap-1">
          {lineup.starters.map((slot) => (
            <li key={slotKey(slot)} className="flex items-center gap-2 text-text-primary">
              <SlotChip slot={slot.slot} />
              <span>{slot.playerName ?? "Empty"}</span>
            </li>
          ))}
        </ul>
        {hasFlexSlot ? <p className="text-xs text-text-muted">{term("flex").short}</p> : null}
        {hasSuperflexSlot ? (
          <p className="flex items-center gap-1 text-xs text-text-muted">
            {term("superflex").short}
            {/* No `helpLevel` here: the short line is already unconditionally on the page (the
                caption above), so a guided reader gains nothing InfoTip's own inline branch
                would add — the trigger stays click-only, opening the longer `detail`. */}
            <InfoTip term="superflex" />
          </p>
        ) : null}
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
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // `id="lineup"` (F16): the fragment `actionHref` builds (`/app/leagues/${id}#lineup`) is a
    // real anchor on a real panel, not a scroll script — Step 1.
    <section id="lineup" className="flex flex-col gap-3">
      <h2 className="text-lg font-medium text-text-primary">{`${formatWeek(lineup.weekNumber)} lineup`}</h2>
      {/* Persona review (veteran, FIX 5): the lock is coarse — the WHOLE week locks at the
          first kickoff, not each player at their own — and nothing said so before this. A
          manager who plans to swap a Monday-night player after watching Sunday's early games
          needs to know that plan won't work before they're locked out of trying it. */}
      <p className="flex items-center gap-1 text-sm text-text-muted">
        Lineups lock for the whole week when its first game kicks off.
        <InfoTip term="lineup-lock" helpLevel={helpLevel} />
      </p>
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
      {/* Persona review (FIX 4): a caption near the slot list, not a tip on every FLEX chip —
          there is only ever one FLEX slot, so one sentence explains it once. */}
      {hasFlexSlot ? <p className="text-xs text-text-muted">{term("flex").short}</p> : null}
      {hasSuperflexSlot ? (
        <p className="flex items-center gap-1 text-xs text-text-muted">
          {term("superflex").short}
          {/* No `helpLevel`: the short line above is already unconditional, so guided readers
              gain nothing InfoTip's own inline branch would add. Click still opens `detail`. */}
          <InfoTip term="superflex" />
        </p>
      ) : null}
      <h3 className="flex items-center gap-1 text-sm font-medium text-text-muted">
        Bench
        <InfoTip term="bench" helpLevel={helpLevel} />
      </h3>
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
