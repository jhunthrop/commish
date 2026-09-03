"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DraftStatus } from "@/domain/draft";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { LineupBody, LineupSlotView } from "../contract";
import { Button, PlayerFace, PositionBadge } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { NOT_STARTED_DASH } from "@/components/ui/game-state-chip";
import { useLeagueRoomDeps } from "../hooks/deps";
import { PlayerName } from "./player-peek";
import { DesignationChip } from "./designation-chip";
import { formatPoints, formatWeek } from "../lib/format";
import { playerOf } from "../lib/player";

const slotKey = (slot: LineupSlotView): string => `${slot.slot}:${slot.slotIndex}`;

/** The ESPN grid's one column template: SLOT | PLAYER | OPP | PROJ | PTS | action. */
const GRID_COLS = "grid-cols-[52px_minmax(0,1fr)_120px_88px_88px_170px]";

/** This week's projection, right-aligned; dash for a man the snapshot does not name. */
function ProjCell({ projections, playerId }: { readonly projections: ReadonlyMap<string, number> | undefined; readonly playerId: string | null }) {
  if (projections === undefined) return <span />;
  const value = playerId === null ? undefined : projections.get(playerId);
  return (
    <span className={`text-right font-display tabular-nums ${value === undefined ? "text-base font-semibold text-text-faint/60" : "text-lg font-semibold text-text-muted"}`}>
      {value === undefined ? NOT_STARTED_DASH : formatPoints(value)}
    </span>
  );
}

/** This week's points; the dash keeps "has not played" distinct from "scored nothing". */
function PointsCell({ points, playerId, loud = false }: { readonly points: ReadonlyMap<string, number | null> | undefined; readonly playerId: string | null; readonly loud?: boolean }) {
  if (points === undefined) return <span />;
  const value = playerId === null ? null : (points.get(playerId) ?? null);
  return (
    <span
      className={`text-right font-display tabular-nums ${value === null ? "text-base font-semibold text-text-faint/60" : loud ? "text-2xl font-bold text-text-primary" : "text-lg font-bold text-text-muted"}`}
    >
      {playerId === null ? "" : value === null ? NOT_STARTED_DASH : formatPoints(value)}
    </span>
  );
}

/** Designations that justify an IR placement — mirrors the server's own set; the server rules. */
const IR_ELIGIBLE = new Set(["O", "IR", "PUP", "NFI", "SUS", "D"]);

/**
 * THE SCHEDULE CELL (founder, 2026-08-30: the ESPN row — opponent and kickoff beside every
 * player). "vs MIN" over "Sun 1:00p", from the real Tank01 schedule; "Live" wears the live
 * channel while the game is on. A team with no fixture this week prints BYE in the verdict
 * red — starting a bye-week player is the mistake this whole column exists to prevent.
 */
function FixtureCell({
  fixtures,
  nflTeam,
}: {
  readonly fixtures: ReadonlyMap<string, { readonly opp: string; readonly when: string; readonly status: "scheduled" | "in_progress" | "final" }> | undefined;
  readonly nflTeam: string;
}) {
  if (fixtures === undefined || nflTeam === "") return null;
  const fixture = fixtures.get(nflTeam);
  if (fixture === undefined) {
    return <span className="w-24 shrink-0 text-right font-mono text-sm font-semibold text-negative">Bye</span>;
  }
  return (
    <span className="flex w-24 shrink-0 flex-col items-end leading-tight">
      <span className="font-mono text-sm text-text-muted">{fixture.opp}</span>
      <span className={`font-mono text-sm ${fixture.status === "in_progress" ? "text-live" : "text-text-faint"}`}>{fixture.when}</span>
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
  pointsByPlayerId,
  fixturesByNflTeam,
  projectionsByPlayerId,
}: {
  readonly leagueId: string;
  readonly lineup: LineupBody;
  /** The season's last week number. Names the reopening condition in the locked message —
   *  "next week" only means something if there is one. */
  readonly totalWeeks: number;
  /** This week's points per playerId, when the page holds the matchup detail — the veteran
   *  persona's missing number ("I set lineups with numbers"). `undefined` player → dash. */
  readonly pointsByPlayerId?: ReadonlyMap<string, number | null>;
  /** The week's real NFL schedule keyed by team (Tank01 via `nfl_games`), already worded:
   *  "@ KC" + "Sun 4:05p" / "Live" / "Final". A team with no entry is on BYE, and the row says
   *  so — the one schedule fact a lineup manager most needs shouted. */
  readonly fixturesByNflTeam?: ReadonlyMap<string, { readonly opp: string; readonly when: string; readonly status: "scheduled" | "in_progress" | "final" }>;
  /** This week's PPR projection per playerId, parsed from the harvested tank01_projections
   *  snapshot — empty/absent when no snapshot matches this week (the dash, never a stale
   *  number). */
  readonly projectionsByPlayerId?: ReadonlyMap<string, number>;
  /** Wave-1 review Q10, SETTLED: `home.draftStatus`, threaded from both `LeagueHome` call sites
   *  — the fact itself, not an inference over the lineup's own empty slots. Optional only for a
   *  caller that genuinely does not know it yet (never true at either real call site); `null` and
   *  `undefined` both read as "not yet drafted", the defensive-fallback direction only, so an
   *  absent fact can never hide a lineup a member is actually supposed to be setting. */
  readonly draftStatus?: DraftStatus | null;
}) {
  const { fetchJson } = useLeagueRoomDeps();
  const router = useRouter();
  const [irStatus, setIrStatus] = useState<string | null>(null);
  const moveInjuredReserve = async (playerId: string, action: "place" | "activate"): Promise<void> => {
    setIrStatus(null);
    try {
      const response = await fetchJson(`/api/leagues/${leagueId}/teams/me/injured-reserve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId, action }),
      });
      const body = (await response.json()) as ApiEnvelope<unknown>;
      if (!body.ok) {
        setIrStatus(body.error);
        return;
      }
      // The roster changed shape on the server; this page's props must not tell an older story.
      router.refresh();
    } catch {
      setIrStatus("We could not reach the server. Check your connection and try again.");
    }
  };
  const [assignments, setAssignments] = useState<Readonly<Record<string, string | null>>>(
    () => Object.fromEntries(lineup.starters.map((slot) => [slotKey(slot), slot.playerId])),
  );
  /** ESPN's selection: a starter slot's key, or `bench:<playerId>`. One at a time, ever. */
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  /** Monotonic save counter: a slow response from an older save never overwrites the story a
   *  newer one is telling. Last write wins, on the wire and on the screen. */
  const saveSeq = useRef(0);

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

  // LOCKED IS THE SAME GRID, read-only (founder, 2026-08-30: the ESPN screen — ESPN's locked
  // week keeps every column and drops the verbs, and a completed-season demo lives in this
  // state almost permanently). Persona FIX 4's sentence survives as the subtitle: say what
  // happens next, and drop the promise on the season's final week.
  const isLocked = lineup.locked;
  const hasNextWeek = lineup.weekNumber < totalWeeks;
  const lockedPlayers = new Set(lineup.lockedPlayerIds);
  const subtitle = isLocked
    ? hasNextWeek
      ? `${formatWeek(lineup.weekNumber)} has ended, so its lineup cannot change. You can set next week's lineup now.`
      : `${formatWeek(lineup.weekNumber)} has ended, so its lineup cannot change.`
    : lockedPlayers.size > 0
      ? "Each player locks at his own kickoff. A locked player stays put until the week ends."
      : "Each player locks at his own kickoff.";

  /**
   * AUTO-SAVE (founder, 2026-08-28: "it should auto save the lineup we shouldn't have a save
   * lineup button"). Every completed swap persists itself: optimistic on screen, reverted to
   * `previous` in the one case the server refuses, with the refusal shown in the server's own
   * words. A second swap during a save simply starts a newer save; the sequence counter keeps a
   * stale response from overwriting a fresher one.
   */
  const autoSave = async (next: Readonly<Record<string, string | null>>, previous: Readonly<Record<string, string | null>>): Promise<void> => {
    const seq = ++saveSeq.current;
    setSaveState("saving");
    setError(null);
    try {
      const response = await fetchJson(`/api/leagues/${leagueId}/teams/me/lineup`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          weekNumber: lineup.weekNumber,
          slots: lineup.starters.map((slot) => ({ slot: slot.slot, slotIndex: slot.slotIndex, playerId: next[slotKey(slot)] ?? null })),
        }),
      });
      const body = (await response.json()) as ApiEnvelope<LineupBody>;
      if (seq !== saveSeq.current) return;
      if (!body.ok) {
        setAssignments(previous);
        setError(body.error);
        setSaveState("idle");
        return;
      }
      setSaveState("saved");
    } catch {
      if (seq !== saveSeq.current) return;
      setAssignments(previous);
      setError("We could not reach the server. Check your connection and try again.");
      setSaveState("idle");
    }
  };

  /**
   * ESPN'S TWO-TAP MODEL (founder, 2026-08-28: "the lineup manager should function just like
   * ESPN's... best in breed"). Tap SWAP on any player, starter or bench: he becomes the
   * selection, every slot he can legally fill lights up with HERE, everything else dims. Tap a
   * destination: the two swap and the selection clears. The bench is DERIVED — whoever is not in
   * a starting slot is on it, live — so a displaced starter falls to the bench by arithmetic
   * rather than by a second write.
   *
   * ELIGIBILITY IS A HINT, NEVER THE AUTHORITY. The map below is the standard slot chart, spent
   * on which HERE buttons light; the server's validateLineup still rules on the save, so a
   * mismatch between this map and a league's real rules costs a lit button, not a corrupt
   * lineup. An unknown slot type lights for everyone for the same reason.
   */
  const eligible = (slotType: string, position: string | null): boolean => {
    if (position === null) return false;
    const chart: Record<string, readonly string[]> = {
      QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], K: ["K"], DEF: ["DEF"],
      FLEX: ["RB", "WR", "TE"], SUPERFLEX: ["QB", "RB", "WR", "TE"],
    };
    const allowed = chart[slotType];
    return allowed === undefined ? true : allowed.includes(position);
  };

  const startingIds = new Set(Object.values(assignments).filter((id): id is string => id !== null));
  /** The selected STARTER slot's type and occupant position, for the both-directions test. */
  const selectedSlotType = (): string | null => {
    if (selected === null || selected.startsWith("bench:")) return null;
    return lineup.starters.find((slot) => slotKey(slot) === selected)?.slot ?? null;
  };
  const benchNow = everyone.filter((slot) => !startingIds.has(slot.playerId!));
  const selectedSlot = selected === null ? null : lineup.starters.find((slot) => slotKey(slot) === selected) ?? null;
  const selectedPlayerId = selected === null ? null : selected.startsWith("bench:") ? selected.slice(6) : (assignments[selected] ?? null);
  const selectedPosition = selectedPlayerId === null ? null : (byId.get(selectedPlayerId)?.position ?? null);

  const placeHere = (targetKey: string): void => {
    if (selectedPlayerId === null && selectedSlot === null) return;
    const previous = assignments;
    const next: Record<string, string | null> = { ...previous };
    const displaced = previous[targetKey] ?? null;
    next[targetKey] = selectedPlayerId;
    // A starter-to-starter move is a true SWAP: the displaced man takes the vacated slot. A
    // bench selection leaves no slot behind, so the displaced man simply falls to the bench.
    if (selected !== null && !selected.startsWith("bench:")) next[selected] = displaced;
    setAssignments(next);
    setSelected(null);
    void autoSave(next, previous);
  };

  /** A starter is selected and a bench row was tapped: the bench man takes the slot, the
   *  displaced starter falls to the derived bench. */
  const swapWithBench = (benchPlayerId: string): void => {
    if (selected === null || selected.startsWith("bench:")) return;
    const previous = assignments;
    const next = { ...previous, [selected]: benchPlayerId };
    setAssignments(next);
    setSelected(null);
    void autoSave(next, previous);
  };

  const sendToBench = (): void => {
    if (selected === null || selected.startsWith("bench:")) return;
    const previous = assignments;
    const next = { ...previous, [selected]: null };
    setAssignments(next);
    setSelected(null);
    void autoSave(next, previous);
  };

  const moving = selected !== null;

  // Totals over the CURRENT starters (the optimistic assignments, not the loaded lineup), known
  // numbers only — `null` when there is nothing to sum, so the row prints blank over fiction.
  const starterIds = lineup.starters.map((slot) => assignments[slotKey(slot)] ?? null).filter((id): id is string => id !== null);
  const knownProj = projectionsByPlayerId === undefined ? [] : starterIds.map((id) => projectionsByPlayerId.get(id)).filter((v): v is number => v !== undefined);
  const startersProjTotal = knownProj.length === 0 ? null : knownProj.reduce((sum, v) => sum + v, 0);
  const knownPoints = pointsByPlayerId === undefined ? [] : starterIds.map((id) => pointsByPlayerId.get(id) ?? null).filter((v): v is number => v !== null);
  const startersPointsTotal = knownPoints.length === 0 ? null : knownPoints.reduce((sum, v) => sum + v, 0);

  return (
    // `id="lineup"` (F16): the fragment `actionHref` builds is a real anchor on a real panel.
    <section id="lineup" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-display text-2xl font-bold text-text-primary">{`${formatWeek(lineup.weekNumber)} lineup`}</h2>
        {/* Under its heading, not orphaned at the far edge (the persona pass, 2026-08-30). */}
        <p className="text-sm text-text-faint">{subtitle}</p>
      </div>

      {/* THE ESPN GRID (founder, 2026-08-30: "This is what an espn screen looks like").
          One full-width table, the incumbent's own column order — SLOT | PLAYER | OPP | PROJ |
          PTS | action — with a totals row after the starters and the bench in the same grid
          below it. The two-tap Swap/Here flow is unchanged; only the geometry moved. */}
      <div className="w-full overflow-x-auto">
        <div className="min-w-[720px]">
          <div aria-hidden="true" className={`grid ${GRID_COLS} items-center gap-x-4 border-b border-line pb-1.5 ${MICRO_LABEL} text-text-faint`}>
            <span className="text-right">Slot</span>
            <span>Player</span>
            <span className="text-right">Opp</span>
            <span className="text-right">Proj</span>
            <span className="text-right">Pts</span>
            <span />
          </div>
          <ul className="flex flex-col">
            {lineup.starters.map((slot) => {
              const key = slotKey(slot);
              const occupantId = assignments[key] ?? null;
              const occupant = occupantId === null ? undefined : byId.get(occupantId);
              const face = occupant === undefined ? null : playerOf(occupant);
              const isSelected = selected === key;
              const occupantPosition = occupant?.position ?? null;
              const fromSlotType = selectedSlotType();
              // BOTH ENDS MUST FIT (founder, 2026-08-28): the selected player must fit THIS
              // slot, and on a starter-to-starter swap the displaced occupant must fit the slot
              // he falls back into. A move that lights is a move that saves.
              const occupantLocked = occupantId !== null && lockedPlayers.has(occupantId);
              const canReceive =
                moving &&
                !isSelected &&
                !occupantLocked &&
                eligible(slot.slot, selectedPosition) &&
                (fromSlotType === null || occupantId === null || eligible(fromSlotType, occupantPosition));
              const dimmed = moving && !isSelected && !canReceive;
              return (
                <li
                  key={key}
                  className={`grid ${GRID_COLS} items-center gap-x-4 border-t border-line border-l-[3px] py-2.5 pl-0 transition-all ${
                    isSelected
                      ? "border-l-accent bg-gradient-to-r from-accent-glow via-transparent to-transparent"
                      : "border-l-transparent"
                  } ${dimmed ? "opacity-40" : ""}`}
                >
                  <span className={`${MICRO_LABEL} text-right text-text-faint`}>{slot.slot}</span>
                  {face === null ? (
                    <span className="flex min-w-0 items-center gap-2.5 text-sm text-text-faint">
                      <span aria-hidden="true" className="size-11 rounded-full border border-dashed border-line" />
                      Empty
                    </span>
                  ) : (
                    <span className="flex min-w-0 items-center gap-2.5">
                      <PlayerFace player={face} size="md" />
                      <span className="flex min-w-0 flex-col">
                        <PlayerName
                          leagueId={leagueId}
                          playerId={face.id}
                          name={face.name}
                          className="truncate font-display text-xl font-bold leading-display text-text-primary"
                        />
                        <span className="flex items-center gap-1.5">
                          <PositionBadge position={face.position} size="sm" />
                          <DesignationChip designation={occupant?.injuryDesignation} />
                          {face.nflTeam === "" ? null : <span className="font-mono text-xs text-text-faint">{face.nflTeam}</span>}
                        </span>
                      </span>
                    </span>
                  )}
                  <span className="justify-self-end">{face === null ? null : <FixtureCell fixtures={fixturesByNflTeam} nflTeam={face.nflTeam} />}</span>
                  <ProjCell projections={projectionsByPlayerId} playerId={occupantId} />
                  <PointsCell points={pointsByPlayerId} playerId={occupantId} loud />
                  <span className="flex items-center justify-end gap-2">
                    {isLocked ? null : canReceive ? (
                      <Button variant="verb" size="sm" onClick={() => placeHere(key)} aria-label={`Put ${byId.get(selectedPlayerId!)?.playerName ?? "the selected player"} at ${slot.slot}`}>
                        Here
                      </Button>
                    ) : isSelected ? (
                      <>
                        <Button variant="secondary" size="sm" onClick={sendToBench}>
                          To bench
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setSelected(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : moving ? null : occupantId === null ? null : occupantLocked ? (
                      <span className={`${MICRO_LABEL} text-text-faint`}>Locked</span>
                    ) : (
                      <Button variant="ghost" size="sm" className="text-text-muted" onClick={() => setSelected(key)} aria-label={`Swap ${occupant?.playerName ?? ""}`}>
                        Swap
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>

          {/* TOTALS — the row ESPN ends its starters on. Sums cover only KNOWN numbers: an
              absent projection or an unplayed man contributes nothing rather than a fake zero. */}
          <div className={`grid ${GRID_COLS} items-center gap-x-4 border-t-2 border-line bg-surface-elevated/40 py-2`}>
            <span />
            <span className={`${MICRO_LABEL} text-text-faint`}>Totals</span>
            <span />
            <span className="text-right font-display text-lg font-bold tabular-nums text-text-muted">
              {startersProjTotal === null ? "" : formatPoints(startersProjTotal)}
            </span>
            <span className="text-right font-display text-xl font-extrabold tabular-nums text-text-primary">
              {startersPointsTotal === null ? "" : formatPoints(startersPointsTotal)}
            </span>
            <span />
          </div>

          {/* THE BENCH, derived live, in the same grid (ESPN keeps one table). While a starter
              is selected only the eligible bench men light with HERE; the dimmed rows are the
              chart, taught by looking. */}
          <h3 className={`${MICRO_LABEL} border-t border-line pb-1 pt-3 text-text-faint`}>Bench</h3>
          {benchNow.length === 0 ? (
            <p className="text-sm text-text-muted">Nobody on the bench.</p>
          ) : (
            <ul className="flex flex-col">
              {benchNow.map((slot) => {
                const key = `bench:${slot.playerId!}`;
                const player = playerOf(slot)!;
                const isSelected = selected === key;
                const fromSlotType = selectedSlotType();
                const benchLocked = lockedPlayers.has(slot.playerId!);
                const canReceive = moving && fromSlotType !== null && !isSelected && !benchLocked && eligible(fromSlotType, player.position);
                const dimmed = moving && !isSelected && !canReceive;
                return (
                  <li
                    key={key}
                    className={`grid ${GRID_COLS} items-center gap-x-4 border-t border-line/50 border-l-[3px] py-2 transition-all ${
                      isSelected
                        ? "border-l-accent bg-gradient-to-r from-accent-glow via-transparent to-transparent"
                        : "border-l-transparent"
                    } ${dimmed ? "opacity-40" : ""}`}
                  >
                    <span className={`${MICRO_LABEL} text-right text-text-faint`}>BN</span>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <PlayerFace player={player} size="md" />
                      <span className="flex min-w-0 flex-col">
                        <PlayerName
                          leagueId={leagueId}
                          playerId={player.id}
                          name={player.name}
                          className="truncate text-lg font-semibold text-text-primary"
                        />
                        <span className="flex items-center gap-1.5">
                          <PositionBadge position={player.position} size="sm" />
                          {player.nflTeam === "" ? null : <span className="font-mono text-xs text-text-faint">{player.nflTeam}</span>}
                        </span>
                      </span>
                    </span>
                    <span className="justify-self-end"><FixtureCell fixtures={fixturesByNflTeam} nflTeam={player.nflTeam} /></span>
                    <ProjCell projections={projectionsByPlayerId} playerId={slot.playerId} />
                    <PointsCell points={pointsByPlayerId} playerId={slot.playerId} />
                    <span className="flex items-center justify-end gap-2">
                      {isLocked ? null : canReceive ? (
                        <Button variant="verb" size="sm" onClick={() => swapWithBench(slot.playerId!)} aria-label={`Swap ${player.name} into the lineup`}>
                          Here
                        </Button>
                      ) : isSelected ? (
                        <Button variant="secondary" size="sm" onClick={() => setSelected(null)}>
                          Cancel
                        </Button>
                      ) : moving ? null : benchLocked ? (
                        <span className={`${MICRO_LABEL} text-text-faint`}>Locked</span>
                      ) : (
                        <>
                          {slot.injuryDesignation != null && IR_ELIGIBLE.has(slot.injuryDesignation) && !isLocked ? (
                            <Button variant="ghost" size="sm" className="text-text-muted" onClick={() => void moveInjuredReserve(slot.playerId!, "place")} aria-label={`Place ${player.name} on injured reserve`}>
                              To IR
                            </Button>
                          ) : null}
                          <Button variant="ghost" size="sm" className="text-text-muted" onClick={() => setSelected(key)} aria-label={`Swap ${player.name}`}>
                            Swap
                          </Button>
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {/* INJURED RESERVE (roadmap item 3): owned but off the roster map — the parked man
              frees a real roster spot for a claim, and comes back through Activate when there
              is room. The server rules on eligibility and capacity; refusals land below in its
              own words. */}
          {lineup.injuredReserve.length === 0 ? null : (
            <>
              <h3 className={`${MICRO_LABEL} border-t border-line pb-1 pt-3 text-text-faint`}>Injured reserve</h3>
              <ul className="flex flex-col">
                {lineup.injuredReserve.map((slot) => {
                  const player = playerOf(slot);
                  if (player === null) return null;
                  return (
                    <li key={`ir-${slot.playerId!}`} className={`grid ${GRID_COLS} items-center gap-x-4 border-t border-line/50 py-2 opacity-90`}>
                      <span className={`${MICRO_LABEL} text-right text-text-faint`}>IR</span>
                      <span className="flex min-w-0 items-center gap-2.5">
                        <PlayerFace player={player} size="md" />
                        <span className="flex min-w-0 flex-col">
                          <PlayerName leagueId={leagueId} playerId={player.id} name={player.name} className="truncate text-lg font-semibold text-text-primary" />
                          <span className="flex items-center gap-1.5">
                            <PositionBadge position={player.position} size="sm" />
                            <DesignationChip designation={slot.injuryDesignation} />
                            {player.nflTeam === "" ? null : <span className="font-mono text-xs text-text-faint">{player.nflTeam}</span>}
                          </span>
                        </span>
                      </span>
                      <span className="justify-self-end"><FixtureCell fixtures={fixturesByNflTeam} nflTeam={player.nflTeam} /></span>
                      <span />
                      <span />
                      <span className="flex items-center justify-end">
                        {isLocked ? null : (
                          <Button variant="ghost" size="sm" className="text-text-muted" onClick={() => void moveInjuredReserve(slot.playerId!, "activate")} aria-label={`Activate ${player.name} from injured reserve`}>
                            Activate
                          </Button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>

      {irStatus === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {irStatus}
        </p>
      )}

      {/* NO SAVE BUTTON (founder ruling): the swap IS the save. The line below is the only
          evidence, and it stays quiet — "Saving" while the wire is out, "saved" once it lands,
          the server's own words if it refuses (with the board already reverted). */}
      <p role="status" aria-live="polite" className="text-sm text-text-faint">
        {saveState === "saving" ? "Saving…" : saveState === "saved" ? "All changes saved." : "\u00A0"}
      </p>
      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </section>
  );
}
