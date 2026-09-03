"use client";

import type { ReactNode } from "react";
import type { TeamCard } from "@/domain/league";
import type { Player, Position } from "@/domain/player";
import type { RosterSlotType } from "@/domain/roster";
import type { DraftStateView } from "@/draft-engine";
import { Avatar, Button, EYEBROW, LowerThird, PositionBadge, SlotChip, type LowerThirdCell } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { formatCoarseRemaining, formatCountdown, useCountdown } from "@/components/ui/countdown";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { formatWaitEstimate, picksUntilYours } from "../state/format";
import { playerName, queueButtonLabel } from "../lib/lookups";
import { moveInQueue, removeFromQueue } from "../state/queue";
import { turnSummary } from "./room-rail";

export type DockMode = "bidding" | "acting" | "watching";

export interface RoomDockProps {
  readonly view: DraftStateView;
  /** The caller's OWN ranked autopick queue. Never anybody else's. */
  readonly queue: readonly string[];
  readonly playersById: ReadonlyMap<string, Player>;
  /** The league's teams, for the strip's turn subject — the same list the rail reads. */
  readonly teams: readonly TeamCard[];
  readonly myTeamId: string | null;
  readonly submitting: boolean;
  /** True only when the server says it is this user's turn to act. */
  readonly canAct: boolean;
  /** "Draft" for snake, "Nominate" for auction. */
  readonly actionLabel: string;
  readonly onAct: (playerId: string) => void;
  readonly onQueueChange: (playerIds: readonly string[]) => void;
  /** `MockRoomInfo.expectedBotPickSeconds`, or null for a real league — Task 10, finding 1:
   *  a bot's turn is priced at this expected value (bot seats read off `teams`), never the
   *  full clock. Null keeps the flat estimate byte-identical for every real-league caller. */
  readonly expectedBotPickSeconds?: number | null;
  /**
   * The auction's live-lot console (`BidControls`), or null. Passing it in rather than
   * building it here is what keeps the dock format-agnostic: it renders whatever occupies its
   * verb slot, and the auction room is the only thing that knows a lot is open.
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
    // `lg:hidden`, inverted from its original `hidden lg:flex` (T2 review HIGH, room-product
    // pass): at lg+ the aside's RosterRail owns the roster — two visible "Your roster"
    // landmarks was a real duplication — while BELOW lg these compact meters become the
    // phone's own answer to "what positions have I filled", which the old gating never showed
    // anywhere the rail wasn't. display:none keeps the hidden copy out of the a11y tree, so
    // exactly one roster landmark is exposed at every width.
    <div className="flex min-w-0 flex-col gap-1 border-t border-line px-4 py-2 lg:hidden">
      <h2 className={`${EYEBROW} text-text-muted`}>Your roster</h2>
      <ul aria-label="Your roster" className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {view.slotConfig.map((config) => (
          <SlotFill key={config.slot} slot={config.slot} filled={filled.filter((slot) => slot.slot === config.slot).length} total={config.count} />
        ))}
      </ul>
    </div>
  );
}

/** The chip controls' reveal-on-intent classes (review E8) — the same idiom `ReactionBar`
 *  documents in full (`src/chat-room/components/reaction-bar.tsx`): hover-capable devices get
 *  quiet-until-wanted, touch stays always-on, focus always reveals. */
const CHIP_REVEAL = "[@media(hover:hover)]:opacity-0 group-hover/chip:opacity-100 group-focus-within/chip:opacity-100 focus-visible:opacity-100 transition-opacity motion-reduce:transition-none";

interface QueueRailProps {
  readonly queue: readonly string[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly draftedIds: ReadonlySet<string>;
  readonly busy: boolean;
  readonly onChange: (playerIds: readonly string[]) => void;
}

/**
 * THE PLAN, ON ONE RESERVED LINE ABOVE THE STRIP (Sunday v5, law 6).
 *
 * The queue is what the lower third's "Queued" cell names, and this is the rail where it can be
 * re-ordered — an `<ol>` because position IS the meaning, and named move/remove buttons because
 * drag reordering is not keyboard-operable. A queued player somebody has since taken is struck
 * through rather than removed: the engine skips them on autopick anyway, and silently vanishing
 * rows is how a plan stops feeling like yours.
 *
 * THE BAND IS ALWAYS RESERVED (`h-10`), empty or not. Inside the room frame the nothing-reflows
 * law beats the nothing-to-say law — the D2 precedent `PickWire`'s own band already set — so
 * starring your first player never shoves the board up ten pixels.
 *
 * The empty state is the one sentence this rail owes a manager, and it quotes C3's sanctioned
 * safety-net phrase verbatim: nothing else in the room says what happens if the clock beats you.
 */
function QueueRail({ queue, playersById, draftedIds, busy, onChange }: QueueRailProps) {
  return (
    <div className="flex min-h-10 shrink-0 items-center gap-2 overflow-hidden border-b border-line px-4 lg:h-10">
      {queue.length === 0 ? (
        // `id="dock-queue"` (Task 4, R3): the anchored `RoomTour`'s "The queue" stop points here.
        // Carried on BOTH this empty-state sentence and the populated rail below, on purpose —
        // the target must exist whether or not a manager has queued anyone yet, so opening the
        // tour with an empty queue still anchors instead of falling back to the modal.
        <p id="dock-queue" className="min-w-0 py-1.5 text-xs text-text-muted lg:truncate lg:py-0">
          Star players in the pool. The room picks for you from your queue if your clock runs out.
        </p>
      ) : (
        <div id="dock-queue" className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className={`${MICRO_LABEL} shrink-0 text-text-faint`}>
            Queue
          </span>
          {/* `[contain:layout]` — D1 (2026-08-26 design review): at 360px the first chip's box
              leaked past this list's `overflow-x-auto` clip into the PAGE's scrollable overflow,
              panning the whole room sideways into a 186px void. Layout containment makes this
              list its own formatting root, so nothing it lays out can ever contribute to an
              ancestor's scrollable overflow. */}
          <ol aria-label="Your queue" className="flex min-w-0 items-center gap-2 overflow-x-auto [contain:layout]">
            {queue.map((playerId, index) => {
              const name = playerName(playersById, playerId);
              const player = playersById.get(playerId);
              const drafted = draftedIds.has(playerId);
              return (
                // `group/chip` is the reveal surface for this chip's own controls (review E8):
                // opacity-only, gated on @media(hover:hover), so touch keeps every control visible
                // and the chip's width never changes — the D1 containment above stays honest.
                <li
                  key={playerId}
                  className="group/chip flex shrink-0 items-center gap-1 rounded-pill bg-surface-raised py-0.5 pl-2 pr-1"
                >
                  <span className="font-mono text-xs tabular-nums text-text-faint">{index + 1}</span>
                  {player === undefined ? null : <PositionBadge position={player.position} size="sm" />}
                  <span className={`max-w-32 truncate font-display text-sm font-semibold ${drafted ? "text-text-muted line-through" : "text-text-primary"}`}>
                    {name}
                  </span>
                  {drafted ? <span className="sr-only">Already drafted</span> : null}
                  <Button size="sm" variant="ghost" className={CHIP_REVEAL} disabled={busy} aria-label={`Move ${name} up`} onClick={() => onChange(moveInQueue(queue, playerId, -1))}>
                    <span aria-hidden="true">←</span>
                  </Button>
                  <Button size="sm" variant="ghost" className={CHIP_REVEAL} disabled={busy} aria-label={`Move ${name} down`} onClick={() => onChange(moveInQueue(queue, playerId, 1))}>
                    <span aria-hidden="true">→</span>
                  </Button>
                  <Button size="sm" variant="ghost" className={CHIP_REVEAL} disabled={busy} aria-label={queueButtonLabel(name, true)} onClick={() => onChange(removeFromQueue(queue, playerId))}>
                    <span aria-hidden="true">×</span>
                  </Button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

/** The pool's own root (`PlayerPool`'s outermost `<section>`) — the one scroll target this
 *  button and the pool ever need to agree on. */
const POOL_TARGET_ID = "player-pool";

/**
 * THE VERB WHEN YOUR QUEUE CANNOT SUPPLY ONE. On your turn with nothing draftable queued there
 * is still exactly one act available, and it is choosing: this scrolls the pool into view and
 * puts the cursor in its search box, at every width. Below `lg` that is a long journey (the pool
 * linearizes after the whole board); at `lg`+ the pool is already beside you and this is simply
 * the fastest way into it.
 *
 * It wears the amber verb because it IS the act the strip is waiting on, and law 6 says the
 * lower third is where the verb lives. It is never rendered off your turn.
 */
function PickFromPoolButton() {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <Button
      size="lg"
      variant="verb"
      data-testid="dock-verb"
      onClick={() => {
        const pool = document.getElementById(POOL_TARGET_ID);
        pool?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
        pool?.querySelector("input")?.focus();
      }}
    >
      Pick from the pool
    </Button>
  );
}

/**
 * THE ROOM'S LOWER THIRD (Sunday v5, law 6) — *"On the draft board that is the pick clock, who
 * is queued, and Draft."* The dock had been a proto lower third since Gameday: a strip across
 * the foot carrying the turn, the plan and the act. This converges it on the primitive's own
 * anatomy — micro-label cells with hairline separators, the clock at display scale in the live
 * channel, one amber verb last.
 *
 * WHAT MOVED HERE, AND WHY THAT IS A SUBTRACTION. The pick clock, the turn subject and the
 * picks-until-yours figure all used to live in the RAIL, and the dock carried a second,
 * phone-only echo of the clock because the rail scrolled away at 360px. One clock, one subject,
 * one place — the echo, its `lg:hidden` gating and the `aria-hidden` duplication it needed are
 * all gone, and the fact is now in the band a manager's hands are already resting on at every
 * width. The five-seat "On deck" strip went with them: "Picks until yours" answers the question
 * that strip was asked, in one figure instead of five truncated names.
 *
 * THE VERB IS ALWAYS PRESENT ON YOUR TURN and never present off it. With a live queue it drafts
 * the top of it in one press; with nothing queued it takes you to the pool. Off your turn the
 * strip carries no action at all, which is law 6's own diagnostic working as intended: there is
 * genuinely no decision to make yet.
 *
 * Fixed height by construction (`lg:h-32`), so the morph between watching, acting and bidding
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
  expectedBotPickSeconds = null,
  bidConsole = null,
}: RoomDockProps) {
  // Called unconditionally, before any branch — React's Rules of Hooks. This is the room's ONE
  // clock now: the rail renders no countdown of its own.
  const { remainingMs, now } = useCountdown(view.deadlineAt);

  const available = new Set(view.availablePlayerIds);
  // Before START_DRAFT the engine has no pool yet, so `availablePlayerIds` is empty — that is
  // "we don't know yet", not "everybody is gone". Same rule the pool follows.
  const preStart = view.phase === "scheduled";
  const draftedIds = new Set(preStart ? [] : queue.filter((playerId) => !available.has(playerId)));
  const targetId = queue.find((playerId) => !draftedIds.has(playerId)) ?? null;
  // Task 5: does MY team owe a pick from an earlier skip? Checked off `view.owedPicks` (rides
  // every payload — `DraftClockView`'s own docblock), never a second fetch. A team that owes a
  // pick may make it on any turn, so the verb is live for them off their own turn too.
  const owesPick = myTeamId !== null && (view.owedPicks?.[myTeamId]?.length ?? 0) > 0;
  const canDraft = canAct || owesPick;
  const mode: DockMode = bidConsole !== null ? "bidding" : canAct ? "acting" : "watching";
  const pausedUntil = view.pausedUntil ?? null;
  const paused = pausedUntil !== null && now !== null && now < Date.parse(pausedUntil);
  const live = view.phase === "in_progress" && !paused;
  const turn = turnSummary(view, teams, playersById, myTeamId);
  const untilYours = picksUntilYours(view.upcoming, myTeamId);
  // Task 10, finding 1: price practice opponents' turns at the seeded delay's expected value.
  const botSeats =
    expectedBotPickSeconds === null
      ? null
      : { ids: new Set(teams.filter((team) => team.isBot === true).map((team) => team.id)), pickSeconds: expectedBotPickSeconds };
  const wait = formatWaitEstimate(view.upcoming, myTeamId, view.clockSeconds, pausedUntil, botSeats);

  const cells: LowerThirdCell[] = [];
  if (view.phase === "scheduled") {
    cells.push({ label: "Draft", value: "Not started" });
  } else if (view.phase === "complete") {
    cells.push({ label: "Draft", value: "Every roster is final" });
  } else {
    cells.push({
      label: turn.mine ? "Your pick" : turn.label,
      // Law 3: a manager is an object, and the face travels with the name onto every surface
      // that draws him. `Avatar` renders a `<span>`, so it nests legally inside the cell's own
      // value span; it is decorative, because the name is right beside it.
      value: (
        <span className="inline-flex items-center gap-2">
          {turn.team === null ? null : <Avatar name={turn.team.ownerDisplayName} avatar={turn.team.ownerAvatarUrl} size="sm" />}
          <span className="truncate">{turn.mine ? "You" : turn.subject}</span>
        </span>
      ),
    });
    if (untilYours !== null && untilYours > 0) {
      cells.push({
        label: untilYours === 1 ? "Pick until yours" : "Picks until yours",
        // The figure is the fact; the estimate is its caption. `formatWaitEstimate` is the same
        // derivation the room's own "You're up in 6 picks (~5m)" sentence uses, so a practice
        // room's bot-priced wait can never disagree with itself between two renderings.
        value: (
          <>
            {untilYours}
            {wait === null ? null : <span className={`${MICRO_LABEL} ml-1.5 align-middle font-sans text-text-faint`}>{wait}</span>}
          </>
        ),
      });
    }
    cells.push({
      label: targetId === null ? "Queued" : "Drafts next",
      value: targetId === null ? "Nobody" : playerName(playersById, targetId),
    });
    if (!paused && remainingMs !== null) {
      cells.push({ label: "Pick clock", value: formatCountdown(remainingMs), clock: true });
    }
  }

  const verb =
    bidConsole ??
    (!canDraft ? null : targetId !== null ? (
      // `verb`, not the ceremonial ink pill (law 5): this is the same act the pool repeats on
      // every row, spelled once more at the size the moment deserves. `primary` is *"the thing a
      // page exists to do once"*, and a draft is sixteen of these.
      <Button size="lg" variant="verb" data-testid="dock-verb" loading={submitting} className="max-w-80 shrink-0 truncate" onClick={() => onAct(targetId)}>
        {actionLabel} {playerName(playersById, targetId)}
      </Button>
    ) : (
      <PickFromPoolButton />
    ));

  return (
    <footer data-testid="room-dock" data-mode={mode} className="flex shrink-0 flex-col border-t border-line bg-surface-elevated lg:h-32">
      <QueueRail queue={queue} playersById={playersById} draftedIds={draftedIds} busy={submitting} onChange={onQueueChange} />
      {/* `id="room-clock"` (Task 4, R3): the anchored `RoomTour`'s "The clock" stop points here.
          It moved off the rail with the clock itself, and it is a better anchor than the one it
          replaces — the strip renders in every phase, where the rail's old clock wrapper existed
          only while a draft was actually running, so the tour now anchors in a scheduled room
          instead of silently falling back to its modal. */}
      <div id="room-clock" className="flex min-h-0 flex-1 flex-col justify-center">
        <LowerThird cells={cells} action={verb} live={live} />
      </div>
      {/* The clock's digits are `aria-hidden` inside the strip, so the turn and the time left are
          both spoken here instead — one polite region for the coarse remaining time, one static
          sentence for whose turn it is. */}
      <p className="sr-only" aria-live="polite">
        {remainingMs === null || paused ? null : formatCoarseRemaining(remainingMs)}
      </p>
      <p className="sr-only">{turn.sentence}</p>
      <RosterFill view={view} myTeamId={myTeamId} />
    </footer>
  );
}
