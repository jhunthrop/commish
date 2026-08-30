"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { DraftStatus } from "@/domain/draft";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { LineupBody, LineupSlotView } from "../contract";
import { Button, PlayerFace, PositionBadge, SlotChip } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { NOT_STARTED_DASH } from "@/components/ui/game-state-chip";
import { useLeagueRoomDeps } from "../hooks/deps";
import { formatPoints, formatWeek } from "../lib/format";
import { playerOf } from "../lib/player";

const slotKey = (slot: LineupSlotView): string => `${slot.slot}:${slot.slotIndex}`;

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
    return <span className="w-20 shrink-0 text-right font-mono text-xs font-semibold text-negative">Bye</span>;
  }
  return (
    <span className="flex w-20 shrink-0 flex-col items-end leading-tight">
      <span className="font-mono text-xs text-text-muted">{fixture.opp}</span>
      <span className={`font-mono text-xs ${fixture.status === "in_progress" ? "text-live" : "text-text-faint"}`}>{fixture.when}</span>
    </span>
  );
}

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
  pointsByPlayerId,
  fixturesByNflTeam,
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

  return (
    // `id="lineup"` (F16): the fragment `actionHref` builds is a real anchor on a real panel.
    <section id="lineup" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-display text-xl font-bold text-text-primary">{`${formatWeek(lineup.weekNumber)} lineup`}</h2>
        {/* Under its heading, not orphaned at the far edge (the persona pass, 2026-08-30). */}
        <p className="text-sm text-text-faint">Lineups lock for the whole week when its first game kicks off.</p>
      </div>

      <div className="grid max-w-4xl gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        {/* STARTERS. Each row is a destination while a move is live: eligible slots carry the
            amber HERE, ineligible ones dim — which is the whole chart taught by looking, with no
            tip anywhere (the no-tips ruling's own test case). */}
        <ul className="flex flex-col">
          {lineup.starters.map((slot) => {
            const key = slotKey(slot);
            const occupantId = assignments[key] ?? null;
            const occupant = occupantId === null ? undefined : byId.get(occupantId);
            const face = occupant === undefined ? null : playerOf(occupant);
            const isSelected = selected === key;
            const occupantPosition = occupant?.position ?? null;
            const fromSlotType = selectedSlotType();
            // BOTH ENDS MUST FIT (founder, 2026-08-28: "if you select a QB it should only
            // highlight the QBs on your bench... visually show what you can do"). The selected
            // player must fit THIS slot, and — on a starter-to-starter swap — the displaced
            // occupant must fit the slot he falls back into. A move that lights is a move that
            // saves; nothing lights that the server would bounce.
            const canReceive =
              moving &&
              !isSelected &&
              eligible(slot.slot, selectedPosition) &&
              (fromSlotType === null || occupantId === null || eligible(fromSlotType, occupantPosition));
            const dimmed = moving && !isSelected && !canReceive;
            return (
              <li
                key={key}
                className={`flex items-center gap-3 border-t border-line border-l-[3px] py-2 pl-2 transition-all ${
                  isSelected
                    ? "border-l-accent bg-gradient-to-r from-accent-glow via-transparent to-transparent"
                    : "border-l-transparent"
                } ${dimmed ? "opacity-40" : ""}`}
              >
                {/* Plain micro text, not a bordered chip: the box read as an empty input to the
                    first-timer. A slot label is a label. */}
                <span className={`${MICRO_LABEL} w-14 shrink-0 text-right text-text-faint`}>{slot.slot}</span>
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
                {face === null ? null : <FixtureCell fixtures={fixturesByNflTeam} nflTeam={face.nflTeam} />}
                {/* THE FIGURE (the veteran persona, 2026-08-30: "not a single number on the
                    entire screen — I set lineups with numbers"). This week's points, straight
                    from the matchup detail the page already holds; the dash keeps the contract's
                    "has not played" vs "scored nothing" distinction. */}
                {pointsByPlayerId === undefined || occupantId === null ? null : (
                  <span
                    className={`shrink-0 font-display tabular-nums ${
                      (pointsByPlayerId.get(occupantId) ?? null) === null ? "text-sm font-semibold text-text-faint/60" : "text-lg font-bold text-text-primary"
                    }`}
                  >
                    {(pointsByPlayerId.get(occupantId) ?? null) === null ? NOT_STARTED_DASH : formatPoints(pointsByPlayerId.get(occupantId)!)}
                  </span>
                )}
                {canReceive ? (
                  <Button variant="verb" size="sm" onClick={() => placeHere(key)} aria-label={`Put ${byId.get(selectedPlayerId!)?.playerName ?? "the selected player"} at ${slot.slot}`}>
                    Here
                  </Button>
                ) : isSelected ? (
                  <span className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={sendToBench}>
                      To bench
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setSelected(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : moving ? null : occupantId === null ? null : (
                  // GHOST AT REST (persona pass, 2026-08-30: sixteen identical outlined pills
                  // read as wallpaper — the chrome outshone the players). The verb keeps its
                  // word (founder ruling: it says "Swap") but drops its border until wanted.
                  <Button variant="ghost" size="sm" className="text-text-muted" onClick={() => setSelected(key)} aria-label={`Swap ${occupant?.playerName ?? ""}`}>
                    Swap
                  </Button>
                )}
              </li>
            );
          })}
        </ul>

        {/* THE BENCH, derived live. While a bench man is selected the starter slots light; while
            a starter is selected every bench row is a legal landing (a bench holds anyone), so
            each carries HERE. */}
        <div className="flex flex-col">
          <h3 className={`${MICRO_LABEL} pb-2 text-text-faint`}>Bench</h3>
          {benchNow.length === 0 ? (
            <p className="text-sm text-text-muted">Nobody on the bench.</p>
          ) : (
            <ul className="flex flex-col">
              {benchNow.map((slot) => {
                const key = `bench:${slot.playerId!}`;
                const player = playerOf(slot)!;
                const isSelected = selected === key;
                const fromSlotType = selectedSlotType();
                // Selecting the QB lights only the bench's QBs; selecting the FLEX lights only
                // RB/WR/TE. The dimmed rows are the chart, taught by looking.
                const canReceive = moving && fromSlotType !== null && !isSelected && eligible(fromSlotType, player.position);
                const dimmed = moving && !isSelected && !canReceive;
                return (
                  <li
                    key={key}
                    className={`flex items-center gap-2.5 border-t border-line border-l-[3px] py-1.5 pl-2 transition-all ${
                      isSelected
                        ? "border-l-accent bg-gradient-to-r from-accent-glow via-transparent to-transparent"
                        : "border-l-transparent"
                    } ${dimmed ? "opacity-40" : ""}`}
                  >
                    <PlayerFace player={player} size="sm" />
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                      <Link
                        className="truncate text-sm font-medium text-text-primary hover:underline"
                        href={`/app/leagues/${leagueId}/players/${player.id}`}
                      >
                        {player.name}
                      </Link>
                      <PositionBadge position={player.position} size="sm" />
                      {player.nflTeam === "" ? null : <span className="font-mono text-xs text-text-faint">{player.nflTeam}</span>}
                    </span>
                    <FixtureCell fixtures={fixturesByNflTeam} nflTeam={player.nflTeam} />
                    {pointsByPlayerId === undefined ? null : (
                      <span
                        className={`shrink-0 font-display tabular-nums ${
                          (pointsByPlayerId.get(slot.playerId!) ?? null) === null ? "text-sm font-semibold text-text-faint/60" : "text-sm font-bold text-text-muted"
                        }`}
                      >
                        {(pointsByPlayerId.get(slot.playerId!) ?? null) === null ? NOT_STARTED_DASH : formatPoints(pointsByPlayerId.get(slot.playerId!)!)}
                      </span>
                    )}
                    {canReceive ? (
                      <Button variant="verb" size="sm" onClick={() => swapWithBench(slot.playerId!)} aria-label={`Swap ${player.name} into the lineup`}>
                        Here
                      </Button>
                    ) : isSelected ? (
                      <Button variant="secondary" size="sm" onClick={() => setSelected(null)}>
                        Cancel
                      </Button>
                    ) : moving ? null : (
                      <Button variant="ghost" size="sm" className="text-text-muted" onClick={() => setSelected(key)} aria-label={`Swap ${player.name}`}>
                        Swap
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

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
