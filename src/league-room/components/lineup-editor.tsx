"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { DraftStatus } from "@/domain/draft";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { LineupBody, LineupSlotView } from "../contract";
import { Button, PlayerFace, PositionBadge, SlotChip } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { useLeagueRoomDeps } from "../hooks/deps";
import { formatWeek } from "../lib/format";
import { playerOf } from "../lib/player";

const slotKey = (slot: LineupSlotView): string => `${slot.slot}:${slot.slotIndex}`;

/**
 * One roster slot's occupant, drawn as an object — face on the club colour, name, position
 * sticker, club code (law 3). An empty slot reads as the word and nothing else: there is no face
 * to draw, and a placeholder tile pretending to be somebody is the failure `PlayerFace` already
 * refuses for an unknown club.
 */
function SlotPlayer({ slot, leagueId }: { readonly slot: LineupSlotView; readonly leagueId: string }) {
  const player = playerOf(slot);
  if (player === null) return <span className="text-sm text-text-faint">Empty</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <PlayerFace player={player} size="sm" />
      {/* THE NAME IS THE DOOR TO HIS OWN SCREEN. "Should he be starting?" is the question this
          panel exists to answer and the panel cannot answer it — a season's shape and where the
          market has him live one route away, and the name is the thing a manager reaches for.
          The LINK is the control, never the row around it: the same rule `PlayerRow` keeps, so a
          list of six bench players has six focus stops with six real names and not one wrapper
          swallowing them. */}
      <Link className="truncate text-sm text-accent underline" href={`/app/leagues/${leagueId}/players/${player.id}`}>
        {player.name}
      </Link>
      <PositionBadge position={player.position} size="sm" />
      {player.nflTeam === "" ? null : <span className="font-mono text-xs text-text-faint">{player.nflTeam}</span>}
    </span>
  );
}

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
  draftStatus,
}: {
  readonly leagueId: string;
  readonly lineup: LineupBody;
  /** The season's last week number. Names the reopening condition in the locked message —
   *  "next week" only means something if there is one. */
  readonly totalWeeks: number;
  /** Wave-1 review Q10, SETTLED: `home.draftStatus`, threaded from both `LeagueHome` call sites
   *  — the fact itself, not an inference over the lineup's own empty slots. Optional only for a
   *  caller that genuinely does not know it yet (never true at either real call site); `null` and
   *  `undefined` both read as "not yet drafted", the defensive-fallback direction only, so an
   *  absent fact can never hide a lineup a member is actually supposed to be setting. */
  readonly draftStatus?: DraftStatus | null;
}) {
  const { fetchJson } = useLeagueRoomDeps();
  const [assignments, setAssignments] = useState<Readonly<Record<string, string | null>>>(
    () => Object.fromEntries(lineup.starters.map((slot) => [slotKey(slot), slot.playerId])),
  );
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const everyone = useMemo(() => [...lineup.starters, ...lineup.bench].filter((slot) => slot.playerId !== null), [lineup]);
  /** Every rosterable player on this team, keyed by id, so the face beside a slot follows the
   *  CURRENT selection rather than the one the page loaded with. Built from the same list the
   *  dropdown options come from, so a face can never appear for a player the select cannot pick. */
  const byId = useMemo(() => new Map(everyone.map((slot) => [slot.playerId!, slot])), [everyone]);
  // League-life review D2 (2026-08-27): a league whose draft has not run has NOTHING on any
  // roster — and the locked branch below told that first-timer "Week 1 has started, so its
  // lineup cannot change" over nine Empty rows. Week 1 had not started; the slots were empty
  // because nobody had drafted, so it gets the honest sentence and no scaffold at all.
  //
  // Wave-1 review Q10, SETTLED: branches on `draftStatus`, the fact itself, threaded from both
  // `LeagueHome` call sites — never on the lineup's own empty slots any more. The original
  // fix inferred "pre-draft" from every slot reading `playerId === null`, which happened to be
  // true whenever the draft had not run, but was never the actual fact being asked about; the
  // inference is deleted outright, not kept as a fallback, per this ruling.
  const preDraft = draftStatus !== "in_progress" && draftStatus !== "complete";
  if (preDraft) {
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
            <li key={slotKey(slot)} className="flex items-center gap-2">
              <SlotChip slot={slot.slot} />
              <SlotPlayer slot={slot} leagueId={leagueId} />
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
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const swap = (targetKey: string, playerId: string | null): void => {
    setAssignments((prev) => {
      const next: Record<string, string | null> = { ...prev };
      if (playerId !== null) {
        // THE SWAP, not the error: picking a player who already starts in another slot moves the
        // displaced starter into the slot the picked player leaves, instead of building a
        // duplicate lineup the server would bounce at save. Pure client state; the server's
        // validateLineup stays the only legality authority.
        const occupied = Object.entries(prev).find(([key, id]) => id === playerId && key !== targetKey);
        if (occupied !== undefined) next[occupied[0]] = prev[targetKey] ?? null;
      }
      next[targetKey] = playerId;
      return next;
    });
    setOpenSlot(null);
    setSaved(false);
  };

  return (
    // `id="lineup"` (F16): the fragment `actionHref` builds (`/app/leagues/${id}#lineup`) is a
    // real anchor on a real panel, not a scroll script — Step 1.
    <section id="lineup" className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-bold text-text-primary">{`${formatWeek(lineup.weekNumber)} lineup`}</h2>
      {/* Persona review (veteran, FIX 5): the lock is coarse and nothing said so. NO TIPS
          (founder ruling): the sentence stays, the trigger died with the system. */}
      <p className="text-sm text-text-muted">Lineups lock for the whole week when its first game kicks off.</p>

      {/* THE WEEKLY RITUAL AS A TOWER, NOT A FORM (founder, 2026-08-28: "set your lineup doesn't
          look or feel premium at all"). Nine native selects were the one place a manager decides
          who PLAYS, drawn as browser chrome: 40px faces beside dropdown arrows, two ragged
          columns, a bench of underlined links. Now each starter is a full row — slot plate, the
          face at md, the name in the display face — and the control is a Swap that opens the
          roster INSIDE the row, every candidate drawn as a player with one amber verb. The
          contract carries no projections, so the row carries no numbers: law 7 outranks decor,
          and the name is still the door to the screen that has them. */}
      <ul className="flex flex-col">
        {lineup.starters.map((slot) => {
          const key = slotKey(slot);
          const chosenId = assignments[key] ?? null;
          const chosen = chosenId === null ? undefined : byId.get(chosenId);
          const face = chosen === undefined ? null : playerOf(chosen);
          const open = openSlot === key;
          return (
            <li key={key} className="border-t border-line">
              <div className="flex items-center gap-3 py-2">
                <SlotChip slot={slot.slot} className="w-16 shrink-0 justify-center" />
                {face === null ? (
                  <span className="flex min-w-0 flex-1 items-center gap-2.5 text-sm text-text-faint">
                    <span aria-hidden="true" className="size-9 rounded-sm border border-dashed border-line" />
                    Empty
                  </span>
                ) : (
                  <span className="flex min-w-0 flex-1 items-center gap-2.5">
                    <PlayerFace player={face} size="md" />
                    <span className="flex min-w-0 flex-col">
                      <Link
                        className="truncate font-display text-lg font-bold leading-display text-text-primary hover:underline"
                        href={`/app/leagues/${leagueId}/players/${face.id}`}
                      >
                        {face.name}
                      </Link>
                      <span className="flex items-center gap-1.5">
                        <PositionBadge position={face.position} size="sm" />
                        {face.nflTeam === "" ? null : <span className="font-mono text-xs text-text-faint">{face.nflTeam}</span>}
                      </span>
                    </span>
                  </span>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  aria-expanded={open}
                  onClick={() => {
                    setOpenSlot(open ? null : key);
                  }}
                >
                  {open ? "Close" : "Swap"}
                </Button>
              </div>
              {open ? (
                <ul className="mb-2 flex flex-col gap-1 border-l-[3px] border-l-accent bg-surface-elevated py-1.5 pl-3 pr-2">
                  {everyone
                    .filter((option) => option.playerId !== chosenId)
                    .map((option) => {
                      const candidate = playerOf(option)!;
                      const startingAt = Object.entries(assignments).find(([, id]) => id === option.playerId)?.[0] ?? null;
                      return (
                        <li key={option.playerId} className="flex items-center gap-2.5 py-1">
                          <PlayerFace player={candidate} size="sm" />
                          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="truncate text-sm font-medium text-text-primary">{candidate.name}</span>
                            <PositionBadge position={candidate.position} size="sm" />
                            {candidate.nflTeam === "" ? null : (
                              <span className="font-mono text-xs text-text-faint">{candidate.nflTeam}</span>
                            )}
                            {startingAt === null ? null : (
                              <span className="font-mono text-xs text-text-faint">starting {startingAt.split(":")[0]}</span>
                            )}
                          </span>
                          <Button variant="verb" size="sm" onClick={() => swap(key, option.playerId)}>
                            Start
                          </Button>
                        </li>
                      );
                    })}
                  {chosenId === null ? null : (
                    <li className="py-1">
                      <Button variant="secondary" size="sm" onClick={() => swap(key, null)}>
                        Leave the slot empty
                      </Button>
                    </li>
                  )}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>

      <h3 className={`${MICRO_LABEL} text-text-faint`}>Bench</h3>
      {lineup.bench.length === 0 ? (
        <p className="text-sm text-text-muted">Nobody on the bench.</p>
      ) : (
        <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {lineup.bench.map((slot) => {
            const player = playerOf(slot);
            if (player === null) return null;
            const starting = Object.values(assignments).includes(slot.playerId);
            return (
              <li key={slotKey(slot)} className="flex min-w-0 items-center gap-2.5 py-0.5">
                <PlayerFace player={player} size="sm" />
                <Link
                  className="truncate text-sm font-medium text-text-primary hover:underline"
                  href={`/app/leagues/${leagueId}/players/${player.id}`}
                >
                  {player.name}
                </Link>
                <PositionBadge position={player.position} size="sm" />
                {player.nflTeam === "" ? null : <span className="font-mono text-xs text-text-faint">{player.nflTeam}</span>}
                {starting ? <span className="font-mono text-xs text-text-faint">starting</span> : null}
              </li>
            );
          })}
        </ul>
      )}

      <div>
        {/* The panel's own act, in the verb's amber — the lower third at the page foot anchors
            here, and the act it names should look like the act it is. */}
        <Button variant="verb" onClick={() => void save()} loading={submitting} disabled={submitting}>
          Save lineup
        </Button>
      </div>
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
