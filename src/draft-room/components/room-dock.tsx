"use client";

import type { ReactNode } from "react";
import type { TeamCard } from "@/domain/league";
import type { Player, Position } from "@/domain/player";
import type { RosterSlotType } from "@/domain/roster";
import type { DraftStateView } from "@/draft-engine";
import { Button, EYEBROW, PositionBadge, SlotChip } from "@/components/ui";
import { formatYourTurn } from "../state/format";
import { playerName, queueButtonLabel } from "../lib/lookups";
import { moveInQueue, removeFromQueue } from "../state/queue";

export type DockMode = "bidding" | "acting" | "watching";

export interface RoomDockProps {
  readonly view: DraftStateView;
  /** The caller's OWN ranked autopick queue. Never anybody else's. */
  readonly queue: readonly string[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTeamId: string | null;
  readonly submitting: boolean;
  /** True only when the server says it is this user's turn to act. */
  readonly canAct: boolean;
  /** "Draft" for snake, "Nominate" for auction. */
  readonly actionLabel: string;
  readonly onAct: (playerId: string) => void;
  readonly onQueueChange: (playerIds: readonly string[]) => void;
  /**
   * Task 10, finding 1: which seats are practice opponents, for the wait estimate alone — a
   * bot's turn is priced at `expectedBotPickSeconds`, never the full clock. Optional so every
   * real-league caller (and test) that omits it keeps the flat estimate unchanged.
   */
  readonly teams?: readonly TeamCard[];
  /** `MockRoomInfo.expectedBotPickSeconds`, or null for a real league. */
  readonly expectedBotPickSeconds?: number | null;
  /**
   * The auction's live-lot console (`BidControls`), or null. Passing it in rather than
   * building it here is what keeps the dock format-agnostic: it renders whatever occupies its
   * primary slot, and the auction room is the only thing that knows a lot is open.
   */
  readonly bidConsole?: ReactNode;
}

/** Slot types that ARE a position, so the fill meter can wear the right sticker. Exported for
 *  `MockResults` (`./mock-results`), which groups a finished roster by the same slot shape —
 *  one map, not a second copy of it. */
export const SLOT_POSITION: Readonly<Partial<Record<RosterSlotType, Position>>> = {
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
      // `basis-full lg:basis-auto`: the same "give the growing term its own line" containment
      // `room-rail.tsx`'s own masthead already applies (NEW-3) — below `lg:` (where the dock is
      // still `flex-wrap`, not yet `flex-nowrap`), `flex-1`'s own `min-w-0` lets this sentence
      // shrink to whatever sliver is left beside `PrimarySlot` on the SAME wrapped line instead
      // of wrapping to its own, which at a phone width squeezed it into a column a few characters
      // wide (a real 360px defect this task's own e2e sweep of the room's mock dressing was the
      // first to reach: the two-team fixture every earlier draft-room spec used never left a
      // human this far from their own turn with an empty queue).
      <p className="min-w-0 basis-full flex-1 self-center text-sm text-text-muted lg:basis-auto">
        Star players in the pool to build your queue. The room picks for you from your queue if your clock runs out.
      </p>
    );
  }

  return (
    <div className="flex min-w-0 basis-full flex-1 flex-col gap-1 lg:basis-auto">
      <h2 className={`${EYEBROW} text-text-muted`}>Your queue</h2>
      <ol aria-label="Your queue" className="flex items-center gap-2 overflow-x-auto pb-1">
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
  /** The standing line off your turn — the wait estimate, or the phase's own quiet fallback. */
  readonly yourTurn: string;
}) {
  if (canAct && targetId !== null) {
    return (
      <Button size="lg" loading={submitting} className="max-w-80 shrink-0 truncate" onClick={() => onAct(targetId)}>
        {actionLabel} {targetName}
      </Button>
    );
  }
  // `basis-full lg:basis-auto` (the same "give the growing term its own line" containment
  // `room-rail.tsx`'s own masthead already applies, NEW-3, and `QueueChips` above now shares):
  // below `lg:` the dock is still `flex-wrap`, and an unqualified `shrink-0` on a display-size
  // sentence held it to a SINGLE line beside `PrimarySlot`'s other siblings regardless of how
  // little room was left, squeezing "Your pick. Take somebody from the pool." (and its two
  // siblings below) into a sliver a few characters wide at a phone width — a real 360px defect
  // this task's own e2e sweep of the room's mock dressing was the first to reach (every earlier
  // draft-room spec's two-team fixture always put a real manager on the clock immediately, never
  // several picks away with an empty queue, and never showed this exact turn-state banner at
  // 360px either). `lg:shrink-0` keeps the desktop layout — a fixed-height dock row, nothing
  // reflowing when the turn changes — untouched.
  if (canAct) {
    return (
      <p data-testid="dock-primary-empty" className="basis-full self-center font-display text-display-sm font-semibold leading-display text-negative lg:basis-auto lg:shrink-0">
        Your pick. Take somebody from the pool.
      </p>
    );
  }
  if (owesPick) {
    // The skip's own courtesy (Task 5): no blame, no banner — the same primary slot every
    // other turn state uses, saying the one thing this manager can do. The pool's own Draft
    // buttons are what actually makes the pick; this is the standing answer to "what now?".
    return (
      <p data-testid="dock-owed-pick" className="basis-full self-center font-display text-display-sm font-semibold leading-display text-warning lg:basis-auto lg:shrink-0">
        Your pick passed while you were away. Make it whenever you are ready.
      </p>
    );
  }
  return (
    <p data-testid="dock-your-turn" className="basis-full self-center font-display text-display-sm font-semibold leading-display text-text-primary lg:basis-auto lg:shrink-0">
      {yourTurn}
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
  myTeamId,
  submitting,
  canAct,
  actionLabel,
  onAct,
  onQueueChange,
  teams = [],
  expectedBotPickSeconds = null,
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
  // Task 10, finding 1: price practice opponents' turns at the seeded delay's expected value.
  const botSeats =
    expectedBotPickSeconds === null
      ? null
      : { ids: new Set(teams.filter((team) => team.isBot === true).map((team) => team.id)), pickSeconds: expectedBotPickSeconds };
  // E11 (fixed at Task 10's persona checkpoint): before kickoff there is no board to watch —
  // the standing line says what the room is actually doing, and the rail above says when.
  const standingLine = formatYourTurn(view.upcoming, myTeamId, view.clockSeconds, view.pausedUntil ?? null, botSeats) ?? (preStart ? "Waiting for kickoff." : "Watching the board.");

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
          yourTurn={standingLine}
        />
      )}
      <QueueChips queue={queue} playersById={playersById} draftedIds={draftedIds} busy={submitting} onChange={onQueueChange} />
      <RosterFill view={view} myTeamId={myTeamId} />
    </footer>
  );
}
