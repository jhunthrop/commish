"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { DraftStatus } from "@/domain/draft";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { LineupBody, LineupSlotView } from "../contract";
import { Button, PlayerFace, PositionBadge, Select, SlotChip } from "@/components/ui";
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

  return (
    // `id="lineup"` (F16): the fragment `actionHref` builds (`/app/leagues/${id}#lineup`) is a
    // real anchor on a real panel, not a scroll script — Step 1.
    <section id="lineup" className="flex flex-col gap-3">
      <h2 className="text-lg font-medium text-text-primary">{`${formatWeek(lineup.weekNumber)} lineup`}</h2>
      {/* Persona review (veteran, FIX 5): the lock is coarse — the WHOLE week locks at the
          first kickoff, not each player at their own — and nothing said so before this. A
          manager who plans to swap a Monday-night player after watching Sunday's early games
          needs to know that plan won't work before they're locked out of trying it. */}
      {/* NO TIPS (founder ruling, 2026-08-28). This sentence WAS the tip's definition, printed
          in full, with the trigger beside it repeating it behind a click. The sentence stays; the
          button goes. */}
      <p className="text-sm text-text-muted">Lineups lock for the whole week when its first game kicks off.</p>
      {/* LAW 3, ON THE SCREEN WHERE IT MATTERS MOST. This grid was nine bare `<select>`s: the
          one place in the product where a manager decides which PLAYERS play, drawn with no
          player in it at all. The face is not decoration — a manager recognises a roster by
          faces and club colours long before they finish reading nine names, which is the
          whole claim law 3 makes. It is derived from the CURRENT selection, so it changes with
          the dropdown rather than reporting what was there on load. An empty slot shows an
          empty tile, never a grey rectangle pretending to be somebody. */}
      <div className="grid gap-2 sm:grid-cols-2">
        {lineup.starters.map((slot) => {
          const chosen = byId.get(assignments[slotKey(slot)] ?? "");
          const face = chosen === undefined ? null : playerOf(chosen);
          return (
            <div key={slotKey(slot)} className="flex items-end gap-2">
              {/* `aria-hidden` on the wrapper, not on `PlayerFace` (which hides its own tile
                  already): the select beside it announces the same player by name, and a face
                  announced a second time is a duplicate, not a fact. `h-10` matches the select's
                  own height so the two sit on one baseline. */}
              <span aria-hidden="true" className="flex h-10 shrink-0 items-center">
                {face === null ? (
                  <span className="size-8 rounded-sm border border-line" />
                ) : (
                  <PlayerFace player={face} size="sm" />
                )}
              </span>
              <Select
                className="w-full"
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
            </div>
          );
        })}
      </div>
      {/* THE FLEX AND SUPERFLEX CAPTIONS ARE GONE (2026-08-28), and they are the clearest case
          of the "assert, do not explain" charter's third tell in the product: *"a rule, then a
          worked example of the same rule, above a control that teaches it faster than either."*
          The control here is a `Select` that offers exactly the players the slot accepts, under a
          `SlotChip` that names it. Nothing true left with them: `/league-rules` carries both
          definitions in full, with a `TermLink`, and the glossary entries themselves are
          untouched. Two sentences and a tip trigger off the screen a manager uses every week. */}
      <h3 className="text-sm font-medium text-text-muted">Bench</h3>
      {/* The bench used to be a comma-joined sentence — six names run together, which is a list
          pretending to be prose and unreadable at a glance on the exact screen where a manager is
          deciding whether one of them should be starting. Law 3 again: they are players, so they
          are drawn as players. */}
      {lineup.bench.length === 0 ? (
        <p className="text-sm text-text-muted">Nobody on the bench.</p>
      ) : (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {lineup.bench.map((slot) => (
            <li key={slotKey(slot)} className="flex items-center gap-2">
              <SlotPlayer slot={slot} leagueId={leagueId} />
            </li>
          ))}
        </ul>
      )}
      {/* Wrapped, so the pill sizes to its own words. In a `flex flex-col` section a bare
          `Button` stretches the full width of a full-bleed shell page, which made the loudest
          thing on the league home a 1300px white bar — law 5 asks for an obvious verb, not a
          billboard, and the lower third at the foot is where the page's one act lives now. */}
      <div>
        <Button onClick={() => void save()} loading={submitting} disabled={submitting}>
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
