"use client";

import type { ReactNode } from "react";
import type { Player, Position } from "@/domain/player";
import type { RosterSlotType } from "@/domain/roster";
import type { TeamCard } from "@/domain/league";
import type { DraftStateView } from "@/draft-engine";
import { Button, EYEBROW, PositionBadge, SlotChip } from "@/components/ui";
import { Countdown, useCountdown } from "@/components/ui/countdown";
import { formatYourTurn } from "../state/format";
import { playerName, queueButtonLabel } from "../lib/lookups";
import { moveInQueue, removeFromQueue } from "../state/queue";
import { turnSummary } from "./room-rail";

export type DockMode = "bidding" | "acting" | "watching";

export interface RoomDockProps {
  readonly view: DraftStateView;
  /** The caller's OWN ranked autopick queue. Never anybody else's. */
  readonly queue: readonly string[];
  readonly playersById: ReadonlyMap<string, Player>;
  /** The league's teams, for the compact clock's turn label (E2) — same list the rail reads. */
  readonly teams: readonly TeamCard[];
  readonly myTeamId: string | null;
  readonly submitting: boolean;
  /** True only when the server says it is this user's turn to act. */
  readonly canAct: boolean;
  /** "Draft" for snake, "Nominate" for auction. */
  readonly actionLabel: string;
  readonly onAct: (playerId: string) => void;
  readonly onQueueChange: (playerIds: readonly string[]) => void;
  /**
   * The auction's live-lot console (`BidControls`), or null. Passing it in rather than
   * building it here is what keeps the dock format-agnostic: it renders whatever occupies its
   * primary slot, and the auction room is the only thing that knows a lot is open.
   */
  readonly bidConsole?: ReactNode;
}

/** Slot types that ARE a position, so the fill meter can wear the right sticker. */
const SLOT_POSITION: Readonly<Partial<Record<RosterSlotType, Position>>> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  DEF: "DEF",
};

/** One slot type's fill: "RB 1/2", wearing its sticker where the slot names a position. */
function SlotFill({ slot, filled, total }: { readonly slot: RosterSlotType; readonly filled: number; readonly total: number }) {
  const position = SLOT_POSITION[slot];
  return (
    <li className="flex items-center gap-1">
      {position === undefined ? (
        <SlotChip slot={slot} />
      ) : (
        <PositionBadge position={position} size="sm" />
      )}
      <span className={`font-mono text-xs tabular-nums ${filled === total ? "text-text-muted" : "text-text-primary"}`}>
        {filled}/{total}
      </span>
    </li>
  );
}

/** My roster, as a row of meters. The only team whose empty slots I can still do anything about. */
function RosterFill({ view, myTeamId }: { readonly view: DraftStateView; readonly myTeamId: string | null }) {
  if (myTeamId === null) return null;
  const filled = view.rosters[myTeamId] ?? [];
  return (
    <div className="hidden shrink-0 flex-col gap-1 lg:flex">
      <h2 className={`${EYEBROW} text-text-muted`}>Your roster</h2>
      <ul aria-label="Your roster" className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {view.slotConfig.map((config) => (
          <SlotFill key={config.slot} slot={config.slot} filled={filled.filter((slot) => slot.slot === config.slot).length} total={config.count} />
        ))}
      </ul>
    </div>
  );
}

interface QueueChipsProps {
  readonly queue: readonly string[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly draftedIds: ReadonlySet<string>;
  readonly busy: boolean;
  readonly onChange: (playerIds: readonly string[]) => void;
}

/**
 * The queue as chips. An `<ol>` because position IS the meaning, and named move/remove
 * buttons because drag reordering is not keyboard-operable. A queued player somebody has
 * since taken is struck through rather than removed — the engine skips them on autopick
 * anyway, and silently vanishing rows is how a plan stops feeling like yours.
 */
function QueueChips({ queue, playersById, draftedIds, busy, onChange }: QueueChipsProps) {
  if (queue.length === 0) {
    return (
      <p className="min-w-0 flex-1 self-center text-sm text-text-muted">
        Star players in the pool to build your queue. The room picks for you from your queue if your clock runs out.
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <h2 className={`${EYEBROW} text-text-muted`}>Your queue</h2>
      {/* `[contain:layout]` — D1 (2026-08-26 design review): at 360px the first chip's box
          leaked past this list's `overflow-x-auto` clip into the PAGE's scrollable overflow,
          panning the whole room sideways into a 186px void. Layout containment makes this
          list its own formatting root, so nothing it lays out can ever contribute to an
          ancestor's scrollable overflow — verified in-browser against the real compiled CSS
          (`overflow-hidden` on the parent did NOT close it). The 360px e2e walk asserts the
          page-level effect with a queued chip present. */}
      <ol aria-label="Your queue" className="flex items-center gap-2 overflow-x-auto pb-1 [contain:layout]">
        {queue.map((playerId, index) => {
          const name = playerName(playersById, playerId);
          const player = playersById.get(playerId);
          const drafted = draftedIds.has(playerId);
          return (
            <li
              key={playerId}
              className="flex shrink-0 items-center gap-1 rounded-pill border border-line bg-surface-elevated py-1 pl-2 pr-1"
            >
              <span className="font-mono text-xs tabular-nums text-text-muted">{index + 1}</span>
              {player === undefined ? null : <PositionBadge position={player.position} size="sm" />}
              <span className={`max-w-32 truncate font-display font-semibold ${drafted ? "text-text-muted line-through" : "text-text-primary"}`}>
                {name}
              </span>
              {drafted ? <span className="sr-only">Already drafted</span> : null}
              <Button size="sm" variant="ghost" disabled={busy} aria-label={`Move ${name} up`} onClick={() => onChange(moveInQueue(queue, playerId, -1))}>
                <span aria-hidden="true">←</span>
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} aria-label={`Move ${name} down`} onClick={() => onChange(moveInQueue(queue, playerId, 1))}>
                <span aria-hidden="true">→</span>
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} aria-label={queueButtonLabel(name, true)} onClick={() => onChange(removeFromQueue(queue, playerId))}>
                <span aria-hidden="true">×</span>
              </Button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * E2 (2026-08-26 design review): below `lg` only the dock sticks — the rail, the room's ONLY
 * clock, scrolled away, so a phone user deep in the pool acted against an invisible clock and
 * the essential loop (see clock, see pool, pick) did not hold at 360px. This is the same clock
 * riding the sticky dock: `lg:hidden`, so the fact is never spoken twice at desktop widths,
 * and its grammar is the rail's own `turnSummary` — one authority, two renderings.
 *
 * `aria-hidden` on purpose: the rail's coarse live region and turn sentence stay in the
 * accessibility tree wherever the page has scrolled, so this echo is visual-only — a second
 * live region would double every clock announcement. Hydration discipline holds: `useCountdown`
 * is null until the client clock snaps and `Countdown` renders its placeholder, never a false
 * "0:00". A paused room renders nothing rather than a frozen, false clock — the dock's own
 * standing sentence already says "once picks resume".
 */
function DockClock({
  view,
  teams,
  playersById,
  myTeamId,
}: {
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTeamId: string | null;
}) {
  // Called unconditionally, before any early return — React's Rules of Hooks.
  const { remainingMs, now } = useCountdown(view.deadlineAt);
  const pausedUntil = view.pausedUntil ?? null;
  const paused = pausedUntil !== null && now !== null && now < Date.parse(pausedUntil);
  if (view.phase !== "in_progress" || view.deadlineAt === null || paused) return null;
  const turn = turnSummary(view, teams, playersById, myTeamId);
  return (
    <div aria-hidden="true" data-testid="dock-clock" className="ml-auto flex shrink-0 flex-col items-end lg:hidden">
      <Countdown remainingMs={remainingMs} size="md" tone={turn.mine ? "hot" : "default"} />
      <span className={`${EYEBROW} ${turn.mine ? "text-negative" : "text-text-muted"}`}>{turn.label}</span>
    </div>
  );
}

/**
 * The dock's left edge: the one thing to do right now. On your turn it is a single button
 * that drafts the top of your queue — one click if you planned. With nothing draftable queued
 * it points at the pool instead of pretending there is a button; the pool is already under
 * your left hand. Off your turn it is the standing answer to "when am I up?".
 */
function PrimarySlot({
  canAct,
  owesPick,
  actionLabel,
  targetId,
  targetName,
  submitting,
  onAct,
  yourTurn,
}: {
  readonly canAct: boolean;
  /** True when this team owes a pick from an earlier skip (Task 5) — checked only once
   *  `canAct` (this team's REAL current turn) has already had its say below. */
  readonly owesPick: boolean;
  readonly actionLabel: string;
  readonly targetId: string | null;
  readonly targetName: string;
  readonly submitting: boolean;
  readonly onAct: (playerId: string) => void;
  readonly yourTurn: string | null;
}) {
  if (canAct && targetId !== null) {
    return (
      <Button size="lg" loading={submitting} className="max-w-80 shrink-0 truncate" onClick={() => onAct(targetId)}>
        {actionLabel} {targetName}
      </Button>
    );
  }
  if (canAct) {
    return (
      <p data-testid="dock-primary-empty" className="shrink-0 self-center font-display text-display-sm font-semibold leading-display text-negative">
        Your pick. Take somebody from the pool.
      </p>
    );
  }
  if (owesPick) {
    // The skip's own courtesy (Task 5): no blame, no banner — the same primary slot every
    // other turn state uses, saying the one thing this manager can do. The pool's own Draft
    // buttons are what actually makes the pick; this is the standing answer to "what now?".
    return (
      <p data-testid="dock-owed-pick" className="shrink-0 self-center font-display text-display-sm font-semibold leading-display text-warning">
        Your pick passed while you were away. Make it whenever you are ready.
      </p>
    );
  }
  return (
    <p data-testid="dock-your-turn" className="shrink-0 self-center font-display text-display-sm font-semibold leading-display text-text-primary">
      {yourTurn ?? "Watching the board."}
    </p>
  );
}

/**
 * The personal band along the bottom of the room: what I have planned, what I have filled,
 * when I am up, and — the instant it is my turn — the single button that acts on all of it.
 * Everything here is about ONE team: mine. The board above is about everybody's.
 *
 * Fixed height by construction (`lg:h-24`), so the morph between watching, acting and bidding
 * never moves the board a pixel.
 */
export function RoomDock({
  view,
  queue,
  playersById,
  teams,
  myTeamId,
  submitting,
  canAct,
  actionLabel,
  onAct,
  onQueueChange,
  bidConsole = null,
}: RoomDockProps) {
  const available = new Set(view.availablePlayerIds);
  // Before START_DRAFT the engine has no pool yet, so `availablePlayerIds` is empty — that is
  // "we don't know yet", not "everybody is gone". Same rule the pool follows.
  const preStart = view.phase === "scheduled";
  const draftedIds = new Set(preStart ? [] : queue.filter((playerId) => !available.has(playerId)));
  const targetId = queue.find((playerId) => !draftedIds.has(playerId)) ?? null;
  // Task 5: does MY team owe a pick from an earlier skip? Checked off `view.owedPicks` (rides
  // every payload — `DraftClockView`'s own docblock), never a second fetch. Quiet on purpose —
  // a courtesy is not a hot turn, so it never flips `mode` the way `canAct` does below.
  const owesPick = myTeamId !== null && (view.owedPicks?.[myTeamId]?.length ?? 0) > 0;
  const mode: DockMode = bidConsole !== null ? "bidding" : canAct ? "acting" : "watching";

  return (
    <footer
      data-testid="room-dock"
      data-mode={mode}
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-surface-elevated px-4 py-2 lg:h-24 lg:flex-nowrap"
    >
      {bidConsole ?? (
        <PrimarySlot
          canAct={canAct}
          owesPick={owesPick}
          actionLabel={actionLabel}
          targetId={targetId}
          targetName={targetId === null ? "" : playerName(playersById, targetId)}
          submitting={submitting}
          onAct={onAct}
          yourTurn={formatYourTurn(view.upcoming, myTeamId, view.clockSeconds, view.pausedUntil ?? null)}
        />
      )}
      <DockClock view={view} teams={teams} playersById={playersById} myTeamId={myTeamId} />
      <QueueChips queue={queue} playersById={playersById} draftedIds={draftedIds} busy={submitting} onChange={onQueueChange} />
      <RosterFill view={view} myTeamId={myTeamId} />
    </footer>
  );
}
