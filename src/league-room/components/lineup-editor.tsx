"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { DraftStatus } from "@research-ts/domain/draft";
import type { Player } from "@research-ts/domain/player";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { LineupBody, LineupSlotView } from "../contract";
import { BigNumber, Button, PlayerFace, PositionBadge } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { rowShellClass, ROW_NAME_CLASS, ROW_META_CLASS } from "@/components/ui/player-row";
import { useLeagueRoomDeps } from "../hooks/deps";
import { PlayerName } from "./player-peek";
import { DesignationChip } from "./designation-chip";
import { formatPoints, formatWeek } from "../lib/format";
import { playerOf } from "../lib/player";

const slotKey = (slot: LineupSlotView): string => `${slot.slot}:${slot.slotIndex}`;

type Fixture = { readonly opp: string; readonly when: string; readonly status: "scheduled" | "in_progress" | "final" };
type FixtureMap = ReadonlyMap<string, Fixture>;

/** Designations that justify an IR placement — mirrors the server's own set; the server rules. */
const IR_ELIGIBLE = new Set(["O", "IR", "PUP", "NFI", "SUS", "D"]);

/**
 * THE SLOT IS THE CONTROL (Sideline, 2026-09-10). The thing you press to pick a man up is the
 * thing that says where he is playing, so a manager never hunts for a separate verb to start a
 * move, and the row's first region is never a decorative label.
 *
 * It wears exactly two skins. Quiet is the default and the one every idle row carries: an outline
 * pill on the control edge, in body ink. Solid is **Confirm** — the one verb this screen has —
 * and it appears only on the slots the selected player can legally fill. P3 counts distinct verbs
 * rather than instances (see `LowerThird`'s own docblock): every solid pill on the screen at once
 * says Confirm and commits the same move, which is a repeated act and not two competing calls.
 *
 * THE THIRD STATE IS THE PRIMITIVE'S OWN (whole-branch review, H1). A slot with nothing to do —
 * a locked week, an empty slot with nobody selected, a locked player — used to render a bare
 * `<span>` wearing a hand-rolled `border border-line`, which `no-raw-surface.source.test.ts`
 * correctly failed: a control's disabled skin is `Button`'s to decide, and a second spelling of it
 * is how two disabled controls start looking different. It is now the same `Button`, disabled,
 * which also makes the state real to a screen reader and to the keyboard instead of decorative.
 */
function SlotControl({
  slot,
  confirm,
  onPress,
  label,
}: {
  readonly slot: string;
  readonly confirm: boolean;
  /** Absent means there is nothing this slot can do right now: the control renders disabled. */
  readonly onPress?: () => void;
  readonly label: string;
}) {
  return (
    <Button
      variant={confirm ? "verb" : "secondary"}
      size="sm"
      disabled={onPress === undefined}
      onClick={onPress}
      aria-label={label}
      className="min-w-12 rounded-pill px-2.5"
    >
      {confirm ? "Confirm" : slot}
    </Button>
  );
}

/** The slot's own short name. BENCH is "BN" on a row that is already under the Bench heading. */
function slotWord(slot: string): string {
  if (slot === "BENCH") return "BN";
  if (slot === "SUPERFLEX") return "SF";
  return slot;
}

/**
 * WHERE AND WHEN HE PLAYS, in one run of small text beside the position (founder, 2026-08-30: the
 * opponent and kickoff belong next to every player). It used to be a 120px column of its own; a
 * Sideline row spends four regions and the fixture is a FACT about the player rather than a
 * fifth. "Bye" keeps the loss channel, because starting a bye-week player is the mistake this
 * whole line exists to prevent, and a running game says so in the live channel.
 */
function fixtureMeta(fixtures: FixtureMap | undefined, nflTeam: string): { readonly text: string; readonly tone: "bye" | "live" | "plain" } | null {
  if (fixtures === undefined || nflTeam === "") return null;
  const fixture = fixtures.get(nflTeam);
  if (fixture === undefined) return { text: "Bye", tone: "bye" };
  return { text: `${fixture.opp}, ${fixture.when}`, tone: fixture.status === "in_progress" ? "live" : "plain" };
}

const FIXTURE_TONE: Readonly<Record<"bye" | "live" | "plain", string>> = {
  bye: "font-semibold text-negative",
  live: "text-live",
  plain: "text-text-muted",
};

/**
 * THE ROW'S ONE NUMBER (P2). A man who has played shows what he scored; a man who has not shows
 * what he is projected for; a man nobody has a number for shows a dash. One figure per row either
 * way, never a projection and a score side by side, because two numbers in one glance is the stat
 * wall P2 rules out.
 *
 * THE KIND, NOT A CAPTION. `LineupRow` builds the caption, because what belongs in it depends on
 * two facts this function cannot see (see `captionFor`).
 */
type RowFigureKind = "measured" | "projected" | "absent";

function rowFigure(
  playerId: string | null,
  points: ReadonlyMap<string, number | null> | undefined,
  projections: ReadonlyMap<string, number> | undefined,
): { readonly value: string | null; readonly kind: RowFigureKind } {
  const scored = playerId === null ? null : (points?.get(playerId) ?? null);
  if (scored !== null) return { value: formatPoints(scored), kind: "measured" };
  const projected = playerId === null ? undefined : projections?.get(playerId);
  if (projected !== undefined) return { value: formatPoints(projected), kind: "projected" };
  return { value: null, kind: "absent" };
}

/**
 * THE CAPTION SLOT GOES TO THE VARIABLE, NOT THE CONSTANT (whole-branch review, M1).
 *
 * The first pass printed "PPR" under all nine rows while the header already said it, and pushed the
 * genuinely per-row fact — who he plays and when — off the phone behind a `hidden sm:inline`. That
 * spends a row's one caption on nine repetitions of a constant and drops the only thing in it that
 * differs by row.
 *
 * So the caption is the FIXTURE, at every width, and the only thing marked is the EXCEPTION: a
 * number that is a forecast rather than a measurement. A measured row needs no basis at all,
 * because it collapses to the header's own ("PPR, final" / "PPR projected, week 18") and P2 asks
 * that the basis be readable in the same glance, not that every row repeat it.
 *
 * A BYE is NOT a fixture and stays on the meta line in the loss channel, because starting a
 * bye-week player is the mistake that line exists to prevent and a caption is too quiet for it.
 */
function captionFor(kind: RowFigureKind, fixtureText: string | null): string {
  if (kind === "absent") return fixtureText === null ? "no number" : `no number, ${fixtureText}`;
  if (kind === "projected") return fixtureText === null ? "projected" : `projected, ${fixtureText}`;
  return fixtureText ?? "";
}

/**
 * ONE LINEUP ROW, on Sideline's shared row shell.
 *
 * IT IS NOT `PlayerRow`, and that is a deliberate call rather than a duplication. `PlayerRow`
 * prints the name as a plain span; on this screen the name has to be a `PlayerName`, which is the
 * press target that opens the peek — the manager's whole research path off a lineup. So this row
 * composes the SAME shell `PlayerRow` and `TeamRow` both compose (`rowShellClass`,
 * `ROW_NAME_CLASS`, `ROW_META_CLASS`, all exported for exactly this), which keeps the 48px
 * rhythm, the 12px plate and the four regions in one place, and spends its own name slot on the
 * peek. Widening `PlayerRow` with a name override would put a second way to draw a player's name
 * in a primitive whose whole job is that there is one.
 *
 * An ABSENT player renders as absence: a dashed ring, the honest sentence, a dash where the
 * number would be. Never a grey tile pretending to be somebody.
 */
function LineupRow({
  leagueId,
  player,
  emptyWord,
  designation,
  fixtures,
  figure,
  selected,
  control,
  action,
}: {
  readonly leagueId: string;
  readonly player: Player | null;
  readonly emptyWord?: string;
  readonly designation?: string | null;
  readonly fixtures: FixtureMap | undefined;
  readonly figure: { readonly value: string | null; readonly kind: RowFigureKind } | null;
  readonly selected: boolean;
  readonly control: ReactNode;
  readonly action: ReactNode;
}) {
  const shell = rowShellClass(selected, selected ? "ring-2 ring-accent" : "");
  if (player === null) {
    // ONE SENTENCE PER EMPTY SLOT (whole-branch review, M2): the banner above says what to do and
    // the slot pill is the verb's own label, so the row says only what is true of it.
    return (
      <div className={shell}>
        <div className="shrink-0">{control}</div>
        <span aria-hidden="true" className="size-9 shrink-0 rounded-pill border border-dashed border-edge" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={`${ROW_NAME_CLASS} text-text-muted`}>{emptyWord ?? "Empty"}</span>
        </div>
        <BigNumber value={null} basis="no starter yet" size="sm" className="shrink-0" />
      </div>
    );
  }
  const fixture = fixtureMeta(fixtures, player.nflTeam);
  const onBye = fixture?.tone === "bye";
  const caption = figure === null ? null : captionFor(figure.kind, onBye || fixture === null ? null : fixture.text);
  return (
    <div className={shell}>
      <div className="shrink-0">{control}</div>
      <PlayerFace player={player} size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <PlayerName leagueId={leagueId} playerId={player.id} name={player.name} className={ROW_NAME_CLASS} />
        <span className={ROW_META_CLASS}>
          <PositionBadge position={player.position} size="sm" />
          {player.nflTeam === "" ? null : <span className="shrink-0 font-mono text-xs text-text-faint">{player.nflTeam}</span>}
          {onBye ? <span className={`shrink-0 ${FIXTURE_TONE.bye}`}>{fixture.text}</span> : null}
          <DesignationChip designation={designation} />
        </span>
      </div>
      {figure === null || caption === null ? null : (
        <BigNumber
          value={figure.value}
          basis={fixture?.tone === "live" ? <span className={FIXTURE_TONE.live}>{caption}</span> : caption}
          size="sm"
          className="shrink-0"
        />
      )}
      {action === null ? null : <div className="shrink-0">{action}</div>}
    </div>
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
  /**
   * THE SLOT MAP, DERIVED FROM PROPS WITH A VERSION KEY (whole-branch review, M5).
   *
   * It used to be `useState(() => …)`, whose initialiser runs exactly once — so when an IR move
   * called `router.refresh()` and the server handed down a different roster, the editor kept
   * rendering the old one. Bounded today because "To IR" only appears on bench rows, but a roster
   * changed in another tab, a commissioner's move, or any future starter-side write left the screen
   * telling a story the server had already replaced.
   *
   * `serverVersion` is the server's own starter map as a string. When it changes, the state resets
   * to the server's story during render — React's documented "adjusting state when a prop changes"
   * pattern, which is cheaper and more correct than an effect (an effect would paint the stale
   * lineup for a frame first). An optimistic swap does NOT change `serverVersion`, so the manager's
   * own in-flight move survives every re-render that is not a new server story.
   */
  const serverAssignments = useMemo(
    () => Object.fromEntries(lineup.starters.map((slot) => [slotKey(slot), slot.playerId])),
    [lineup.starters],
  );
  const serverVersion = useMemo(
    () => lineup.starters.map((slot) => `${slotKey(slot)}=${slot.playerId ?? ""}`).join("|"),
    [lineup.starters],
  );
  const [slotState, setSlotState] = useState<{ readonly version: string; readonly assignments: Readonly<Record<string, string | null>> }>(
    () => ({ version: serverVersion, assignments: serverAssignments }),
  );
  if (slotState.version !== serverVersion) {
    setSlotState({ version: serverVersion, assignments: serverAssignments });
  }
  const assignments = slotState.version === serverVersion ? slotState.assignments : serverAssignments;
  const setAssignments = (next: Readonly<Record<string, string | null>>): void => {
    setSlotState({ version: serverVersion, assignments: next });
  };
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

  /**
   * THE ONE BIG NUMBER, AND A BASIS IT ACTUALLY HAS (P2, P11 — whole-branch review, C1).
   *
   * The first pass took the measured total the moment ANY starter had played and captioned it "PPR,
   * your starters in week 18". Between Thursday night and Sunday afternoon — the window a manager
   * actually opens this screen in — that printed one Thursday starter's 12.40 under a caption
   * claiming nine contributors, beside a foot reading "Your 9". The number named a basis it did not
   * have, every single week.
   *
   * THE RULING: the headline is the PROJECTED total until every starter has played, then the
   * MEASURED total, called final. A partial week is not hidden — it is stated separately, on its
   * own line, as what it is ("3 of 9 played, 41.2 so far"), which is a true sentence about a real
   * subset rather than a false caption on a total.
   *
   * The projection's own caption is honest the same way: a snapshot that names only some of the
   * starters says so rather than captioning a partial sum as the whole lineup.
   */
  const starterCount = lineup.starters.length;
  const allPlayed =
    starterCount > 0 &&
    lineup.starters.every((slot) => {
      const id = assignments[slotKey(slot)] ?? null;
      return id !== null && (pointsByPlayerId?.get(id) ?? null) !== null;
    });
  const weekWord = formatWeek(lineup.weekNumber).toLowerCase();
  const headline = allPlayed
    ? { value: formatPoints(startersPointsTotal ?? 0), basis: "PPR, final" }
    : startersProjTotal === null
      ? { value: null, basis: "no projection for this week yet" }
      : {
          value: formatPoints(startersProjTotal),
          basis: knownProj.length === starterCount ? `PPR projected, ${weekWord}` : `PPR projected, ${knownProj.length} of ${starterCount} starters`,
        };
  /** What is actually on the board so far, said as the subset it is. `null` before anybody has
   *  played and once everybody has, because in neither case is there a partial to disclose. */
  const soFar =
    allPlayed || startersPointsTotal === null || knownPoints.length === 0
      ? null
      : `${knownPoints.length} of ${starterCount} played, ${formatPoints(startersPointsTotal)} so far`;

  /** The one thing wrong with this lineup, said the way a friend would say it (P7). */
  const emptySlot = lineup.starters.find((slot) => (assignments[slotKey(slot)] ?? null) === null) ?? null;

  return (
    // `id="lineup"` (F16): the fragment `actionHref` builds is a real anchor on a real panel.
    <section id="lineup" className="flex flex-col gap-3">
      {/* THE HEAD: the week, then the one big number with its basis (P1, P2). */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl bg-surface-elevated p-4 shadow-card">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="font-display text-2xl font-bold text-text-primary">{`${formatWeek(lineup.weekNumber)} lineup`}</h2>
          {/* Under its heading, not orphaned at the far edge (the persona pass, 2026-08-30). */}
          <p className="text-sm text-text-faint">{subtitle}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <BigNumber value={headline.value} basis={headline.basis} size="lg" />
          {/* WHAT IS ACTUALLY IN, as its own sentence rather than as a caption on a total that is
              not it. A partial week has two true things to say and this is the second. */}
          {soFar === null ? null : <p className="text-sm text-text-muted">{soFar}</p>}
        </div>
      </div>

      {/* THE ONE THING WRONG, and only once (whole-branch review, M2). It carries no verb of its
          own — the slot pill on the row below is the verb's own label, and a second solid button up
          here would be P3's two competing calls to action — and it names NO DAY, because an empty
          slot has no player, therefore no club, therefore no fixture to read a kickoff off. The
          first pass hardcoded "for Sunday" for a slot whose game may be a Thursday or a Monday. */}
      {emptySlot === null || isLocked ? null : (
        <p className="rounded-xl border-l-[3px] border-l-self bg-surface-elevated px-4 py-3 font-display text-md font-bold text-text-primary shadow-raised">
          {`Your ${slotWord(emptySlot.slot).toLowerCase()} is empty.`}
        </p>
      )}

      {/* SIDELINE'S ROWS (2026-09-10). The ESPN grid — six columns, a 720px minimum width and a
          sideways scroll on a phone — is gone. A row is 48px with a 36px face, the slot as its
          control, the name largest, and ONE number at the right with its basis. The two-tap
          Swap/Confirm flow is unchanged; only the geometry moved, and it now fits 360px without a
          horizontal scroller. */}
      <div className="flex flex-col rounded-xl bg-surface-elevated p-2 shadow-card">
        <h3 className={`${MICRO_LABEL} px-2.5 pb-1 pt-2 text-text-faint`}>Starters</h3>
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
              <li key={key} className={dimmed ? "opacity-40" : ""}>
                <LineupRow
                  leagueId={leagueId}
                  player={face}
                  emptyWord={`Nobody in your ${slotWord(slot.slot).toLowerCase()}`}
                  designation={occupant?.injuryDesignation}
                  fixtures={fixturesByNflTeam}
                  figure={rowFigure(occupantId, pointsByPlayerId, projectionsByPlayerId)}
                  selected={isSelected}
                  control={
                    <SlotControl
                      slot={slotWord(slot.slot)}
                      confirm={canReceive}
                      label={
                        canReceive
                          ? `Confirm ${byId.get(selectedPlayerId!)?.playerName ?? "the selected player"} at ${slot.slot}`
                          : // A control that cannot be pressed is named for what it IS rather than
                            // for an act it will not perform: a locked week's slots say who plays
                            // there, they do not offer a swap nobody can make.
                            occupantId === null || occupantLocked || isLocked || moving
                            ? `${occupant?.playerName ?? "Nobody"} plays ${slot.slot}`
                            : `Swap ${occupant?.playerName ?? `whoever plays ${slot.slot}`}`
                      }
                      onPress={
                        isLocked
                          ? undefined
                          : canReceive
                            ? () => placeHere(key)
                            : moving || occupantId === null || occupantLocked
                              ? undefined
                              : () => setSelected(key)
                      }
                    />
                  }
                  action={
                    isLocked ? null : isSelected ? (
                      <span className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="text-text-muted" onClick={sendToBench}>
                          To bench
                        </Button>
                        <Button variant="ghost" size="sm" className="text-text-muted" onClick={() => setSelected(null)}>
                          Cancel
                        </Button>
                      </span>
                    ) : occupantLocked ? (
                      <span className={`${MICRO_LABEL} text-text-faint`}>Locked</span>
                    ) : null
                  }
                />
              </li>
            );
          })}
        </ul>

        {/* THE TOTAL, restated at the foot of the column the eye just read down. It is the SAME
            fact the head's big number carries, at row size, so the screen still shows one.

            THE LABEL NAMES NO COUNT (whole-branch review, C1). It read "Your 9" beside whatever the
            head was showing, which on a partly-played week was a claim about nine contributors
            standing over a sum of one. The head's own caption already says what the figure is and
            over how many starters, so the label here says only whose it is. */}
        <div className="flex items-center justify-between gap-3 border-t border-line px-2.5 pb-1 pt-3">
          <span className={`${MICRO_LABEL} text-text-faint`}>Your starters</span>
          <BigNumber value={headline.value} basis={headline.basis} size="sm" />
        </div>

        {/* THE BENCH, derived live. While a starter is selected only the eligible bench men carry
            a solid Confirm; the dimmed rows are the slot chart, taught by looking. */}
        <h3 className={`${MICRO_LABEL} px-2.5 pb-1 pt-4 text-text-faint`}>Bench</h3>
        {benchNow.length === 0 ? (
          <p className="px-2.5 text-sm text-text-muted">Nobody on the bench.</p>
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
                <li key={key} className={dimmed ? "opacity-40" : ""}>
                  <LineupRow
                    leagueId={leagueId}
                    player={player}
                    designation={slot.injuryDesignation}
                    fixtures={fixturesByNflTeam}
                    figure={rowFigure(slot.playerId, pointsByPlayerId, projectionsByPlayerId)}
                    selected={isSelected}
                    control={
                      <SlotControl
                        slot="BN"
                        confirm={canReceive}
                        label={
                          canReceive
                            ? `Confirm ${player.name} into the lineup`
                            : isLocked || benchLocked || moving
                              ? `${player.name} is on your bench`
                              : `Swap ${player.name}`
                        }
                        onPress={
                          isLocked ? undefined : canReceive ? () => swapWithBench(slot.playerId!) : moving || benchLocked ? undefined : () => setSelected(key)
                        }
                      />
                    }
                    action={
                      isLocked ? null : isSelected ? (
                        <Button variant="ghost" size="sm" className="text-text-muted" onClick={() => setSelected(null)}>
                          Cancel
                        </Button>
                      ) : benchLocked ? (
                        <span className={`${MICRO_LABEL} text-text-faint`}>Locked</span>
                      ) : moving || slot.injuryDesignation == null || !IR_ELIGIBLE.has(slot.injuryDesignation) ? null : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-text-muted"
                          onClick={() => void moveInjuredReserve(slot.playerId!, "place")}
                          aria-label={`Place ${player.name} on injured reserve`}
                        >
                          To IR
                        </Button>
                      )
                    }
                  />
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
            <h3 className={`${MICRO_LABEL} px-2.5 pb-1 pt-4 text-text-faint`}>Injured reserve</h3>
            <ul className="flex flex-col">
              {lineup.injuredReserve.map((slot) => {
                const player = playerOf(slot);
                if (player === null) return null;
                return (
                  <li key={`ir-${slot.playerId!}`}>
                    <LineupRow
                      leagueId={leagueId}
                      player={player}
                      designation={slot.injuryDesignation}
                      fixtures={fixturesByNflTeam}
                      figure={null}
                      selected={false}
                      control={<SlotControl slot="IR" confirm={false} label="On injured reserve" />}
                      action={
                        isLocked ? null : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-text-muted"
                            onClick={() => void moveInjuredReserve(slot.playerId!, "activate")}
                            aria-label={`Activate ${player.name} from injured reserve`}
                          >
                            Activate
                          </Button>
                        )
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </>
        )}
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
        {saveState === "saving" ? "Saving…" : saveState === "saved" ? "All changes saved." : " "}
      </p>
      {error === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}
    </section>
  );
}