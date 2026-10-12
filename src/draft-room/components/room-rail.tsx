"use client";

import Link from "next/link";
import type { TeamCard } from "@/domain/league";
import type { Player } from "@research/domain/player";
import type { DraftStateView } from "@/draft-engine";
import type { WaitingInfo } from "../contract";
import { Badge, EYEBROW } from "@/components/ui";
import { BrandMark } from "@/components/ui/brand-mark";
import { Countdown, useCountdown, type CountdownSize } from "@/components/ui/countdown";
import { SessionNotice } from "@/components/app-shell/session-notice";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { formatClockLength, formatPausedUntil, formatTightening } from "../state/format";
import { playerName, teamName, teamsById } from "../lib/lookups";
import type { ConnectionStatus } from "../hooks/use-draft-room";
import { ConnectionBanner } from "./connection-banner";

export type RoomRailVariant = "room" | "tv";
/** The four states the whole room morphs between. The rail is where the morph is loudest. */
export type RoomMode = "scheduled" | "watching" | "hot" | "complete";

export interface RoomRailProps {
  readonly leagueName: string;
  readonly view: DraftStateView;
  readonly teams: readonly TeamCard[];
  readonly myTeamId: string | null;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly connection: ConnectionStatus;
  /** `tv` drops the personal chrome — no team chip, no my-turn heat. */
  readonly variant?: RoomRailVariant;
  /**
   * R2: the scheduled room's waiting story, straight off the snapshot
   * (`DraftSnapshotBody.waiting`) — the kickoff instant this rail counts down to and the
   * trigger-aware sentence it quotes. Read only while `view.phase === "scheduled"`; a live or
   * finished room ignores it entirely. Omitted (or null) it degrades to the bare headline —
   * never to an invented sentence about a commissioner the room may not have.
   */
  readonly waiting?: WaitingInfo | null;
}

const FORMAT_LABEL: Readonly<Record<DraftStateView["format"], string>> = {
  snake: "Snake draft",
  auction: "Auction draft",
};

const LEAGUE_TEXT: Readonly<Record<RoomRailVariant, string>> = {
  room: "text-display-md",
  tv: "text-display-xl",
};

/**
 * Task 12 Step 3: the TV board is read from across a room, and it is the one surface where `xs`
 * never appears. The room variant keeps `EYEBROW`'s ordinary `text-xs`; the TV variant steps
 * every eyebrow-shaped label THIS COMPONENT AUTHORS (the turn label, the waiting/complete
 * headline, the tightening line) up to `text-sm` instead of reusing `EYEBROW` outright.
 *
 * SCOPE, STATED: this does not reach into `Badge` (the format chip, the pending-picks pill) or
 * `Avatar`'s `sm` initials — both are fixed-size chrome shared by every surface in the product,
 * not typographic choices this rail makes, and giving every shared primitive a caller-specific
 * size variant for one room's reading distance would be a primitives refactor this task does not
 * own. The rule binds the rail's OWN prose and labels; it does not cascade into the two shared
 * chips riding beside them.
 */
const RAIL_EYEBROW: Readonly<Record<RoomRailVariant, string>> = {
  room: EYEBROW,
  tv: "font-display text-sm font-semibold tracking-wide",
};

/** The tightening line's own size: an ordinary sentence in the room, bumped one step for the TV
 *  variant's "no `xs` anywhere" rule (Step 3) — it is prose, not a chip, so it earns `text-sm`
 *  rather than joining `RAIL_EYEBROW`'s label treatment. */
const TIGHTENING_TEXT: Readonly<Record<RoomRailVariant, string>> = {
  room: "text-xs",
  tv: "text-sm",
};

/** The KICKOFF countdown's size — the only clock this rail still renders. A room's PICK clock
 *  moved to the lower third (`RoomDock`, Sunday v5 law 6) and the TV's to its spotlight band,
 *  which is what keeps one clock per screen honest; a kickoff instant is a masthead fact about
 *  when the room opens, and it never coexists with a pick clock. The TV takes the larger step
 *  for its own reading distance. */
const RAIL_COUNTDOWN_SIZE: Readonly<Record<RoomRailVariant, CountdownSize>> = {
  room: "lg",
  tv: "xl",
};

/**
 * The rail's whole visual morph, in one map. `hot` is the LIVE family (Sunday v5's third
 * channel), because the one moment the room should stop being calm is the sixty seconds that
 * belong to you — and "happening right now" is exactly what that channel was split off to mean.
 *
 * Through v4 one red carried both "happening now" and "this is bad", so a running clock and a
 * failed write wore the same pigment. v5 separates them: `live` is the clock, the on-the-clock
 * cell and the hot rail; `negative` stays with the verdict pair and with genuine failure.
 */
const MODE_SKIN: Readonly<Record<RoomMode, string>> = {
  scheduled: "border-line bg-surface-elevated",
  watching: "border-line bg-surface-elevated",
  hot: "border-live bg-live/10",
  complete: "border-line bg-surface-elevated",
};

interface TurnSummary {
  /** The eyebrow above the subject: "You are on the clock", "Live bid", … */
  readonly label: string;
  /** Who or what the turn is about — a team name, or the player up for bid. */
  readonly subject: string;
  /** The same fact as a sentence, for screen readers, since the digits are `aria-hidden`. */
  readonly sentence: string;
  readonly mine: boolean;
  /** The team `subject` names, for the face beside it — `null` when the subject is a PLAYER
   *  (a live bid) rather than a team, since a face belongs next to the person it names. */
  readonly team: TeamCard | null;
}

/**
 * Which round the board is on: how many picks the team on the clock already owns, plus one —
 * the same "your next empty row" derivation `DraftBoard` uses. Falls back to the round of the
 * last completed pick, and to round 1 on an untouched board. Nothing here restates a
 * turn-order rule; it counts what already happened.
 */
function currentRound(view: DraftStateView): number {
  if (view.onClockTeamId !== null) {
    return view.picks.filter((pick) => pick.teamId === view.onClockTeamId).length + 1;
  }
  return view.picks[view.picks.length - 1]?.round ?? 1;
}

/** The one-line "where are we" label. An auction has lots, not rounds. */
function turnLabel(view: DraftStateView): string | null {
  if (view.phase !== "in_progress") return null;
  if (view.format === "auction") return `Lot ${view.pickNumber}`;
  return `Round ${currentRound(view)} · Pick ${view.pickNumber}`;
}

/**
 * How many picks the room currently owes, total across every team (Task 5) — a plain count,
 * never a name: the board's own pending cells (and each owing manager's own dock) say WHO,
 * this rail says only THAT, the same "no accusation" restraint `copyViolations` holds every
 * notice to. Zero for an auction (Task 5 excludes it entirely) and before `owedPicks` rides
 * the payload at all (this engine's own test suite predates Task 5).
 */
function pendingPickCount(view: DraftStateView): number {
  return Object.values(view.owedPicks ?? {}).reduce((total, owed) => total + owed.length, 0);
}

/**
 * Whose turn it is, said once. An auction lot has no `onClockTeamId` by design — the clock
 * belongs to everyone while bidding is open — so this branches on `view.format` rather than
 * ever claiming somebody is "on the clock" during a live lot. This is also where the
 * `AuctionLotPanel` went: the standing bid and its holder are a fact about *the turn*, and the
 * turn has exactly one home.
 *
 * Exported for exactly one other consumer: `RoomDock`'s compact below-`lg` clock echo (E2),
 * which must speak THIS grammar rather than derive a second one — one authority for whose
 * turn it is, two places that render it.
 */
export function turnSummary(
  view: DraftStateView,
  teams: readonly TeamCard[],
  playersById: ReadonlyMap<string, Player>,
  myTeamId: string | null,
): TurnSummary {
  const byId = teamsById(teams);
  const lot = view.format === "auction" ? (view.auction?.lot ?? null) : null;

  if (lot !== null) {
    const name = playerName(playersById, lot.playerId);
    const bidder = teamName(byId, lot.highBidTeamId, "Someone");
    return {
      label: "Live bid",
      subject: `${name} · $${lot.highBid}`,
      sentence: `Bidding is open on ${name}. High bid $${lot.highBid} by ${bidder}.`,
      mine: false,
      team: null,
    };
  }

  if (view.format === "auction") {
    const nominatorId = view.auction?.nominatingTeamId ?? null;
    const who = nominatorId === null ? "Nobody" : teamName(byId, nominatorId, "Someone");
    const mine = nominatorId !== null && nominatorId === myTeamId;
    return {
      label: mine ? "You are nominating" : "Nominating",
      subject: who,
      sentence: `${who} is nominating.`,
      mine,
      team: nominatorId === null ? null : (byId.get(nominatorId) ?? null),
    };
  }

  const who = view.onClockTeamId === null ? "Nobody" : teamName(byId, view.onClockTeamId, "Someone");
  const mine = view.onClockTeamId !== null && view.onClockTeamId === myTeamId;
  const clockLength = view.clockSeconds === null ? "" : ` This round's pick clock is ${formatClockLength(view.clockSeconds)}.`;
  return {
    label: mine ? "You are on the clock" : "On the clock",
    subject: who,
    sentence: `${who} is on the clock.${clockLength}`,
    mine,
    team: view.onClockTeamId === null ? null : (byId.get(view.onClockTeamId) ?? null),
  };
}

function modeOf(view: DraftStateView, turn: TurnSummary): RoomMode {
  if (view.phase === "scheduled") return "scheduled";
  if (view.phase === "complete") return "complete";
  return turn.mine ? "hot" : "watching";
}

/** The waiting and finished states: one plain sentence, nothing to hunt for. The HEADLINE that
 *  used to sit above it is gone (Sunday v5) — the lower third's own phase cell already names
 *  "Not started" and "Complete" in the shouted register, and this rail restating the same two
 *  words in an eyebrow was the "same fact stated twice, differently" pattern the room keeps
 *  finding in itself. `detail` is nullable for R2's degraded case (a scheduled room whose
 *  snapshot carried no waiting story): the block simply renders nothing rather than the rail
 *  inventing a sentence. `max-w-md` caps the one long detail (`describeStartTiming`'s when-full
 *  commitment, three sentences) so it wraps as a paragraph instead of stretching the masthead. */
function StaticState({ detail }: { readonly detail: string | null }) {
  if (detail === null) return null;
  return <span className="max-w-md text-sm text-text-muted">{detail}</span>;
}

/**
 * THE ROOM'S MASTHEAD (Sunday v5, law 6): league, format, where the board is, what the room is
 * waiting on, and the way out. It is no longer the room's clock.
 *
 * WHAT LEFT, AND WHY. Through v4 this rail carried the moment as well as the masthead — the turn
 * subject at display scale, the pick clock, the picks-until-yours figure — and the dock carried a
 * second, `lg:hidden` copy of that clock because the rail scrolled away on a phone. Law 6 gives
 * the moment a place of its own: *"On the draft board that is the pick clock, who is queued, and
 * Draft."* All three moved down to `RoomDock`'s lower third, the phone echo went with them, and
 * what stays here is the standing description of the room rather than the state of this turn.
 *
 * The rail still MORPHS with the turn (`MODE_SKIN`'s live tint, and the pulse beside the round
 * label): the whole frame going live is the broadcast move, and the strip at the foot is where
 * the words for it live.
 *
 * It is a fixed-HEIGHT-FLOOR band (`lg:min-h-20`): the stage below gets every remaining pixel,
 * and nothing reflows when the turn changes. `min-h` rather than a hard `h` so a long waiting
 * detail wraps instead of being clipped.
 */
export function RoomRail({ leagueName, view, teams, myTeamId, playersById, connection, variant = "room", waiting }: RoomRailProps) {
  // The TV board is nobody's team: `personalId` is what every personal affordance reads, so
  // dropping the chrome for that variant is one assignment rather than a flag per element.
  const personalId = variant === "room" ? myTeamId : null;
  const turn = turnSummary(view, teams, playersById, personalId);
  const mode = modeOf(view, turn);
  // R2: the waiting story is a fact about a SCHEDULED room only — a stale `waiting` riding a
  // snapshot that has since gone live must never leak a kickoff clock into a live rail.
  const waitingInfo = view.phase === "scheduled" ? (waiting ?? null) : null;
  // The rail's ONE clock, its target switched by phase: the kickoff instant while scheduled
  // (R2), the pick deadline once live — one `useCountdown`, never two ticking intervals.
  // Called unconditionally, before any early return — React's Rules of Hooks. `now` is the
  // same wall-clock reading `remainingMs` came from, so the tightening line shares this one
  // ticking interval instead of running a second `useNow` beside it.
  const { remainingMs, now } = useCountdown(view.phase === "scheduled" ? (waitingInfo?.kickoffAt ?? null) : view.deadlineAt);
  const pausedUntil = view.pausedUntil ?? null;
  // Live, not a one-shot read of the payload: `now` ticks every second (the same `useCountdown`
  // reading `remainingMs` came from), so a turn that started BEFORE the freeze but runs into it
  // — the common case — still shows this once the clock actually crosses in, and "the countdown
  // resumes on the next frame" (Task 4) falls out of this same comparison flipping back once
  // `now` passes `pausedUntil`, with no new event required. `now` is null on the server render
  // and the hydrating render (`useNow`'s hydration contract): both clock-derived lines hold
  // their non-ticking fallback (nothing) for that one frame rather than reading a clock the
  // server and client would disagree on.
  const paused = pausedUntil !== null && now !== null && now < Date.parse(pausedUntil);
  const tightening = now === null ? null : formatTightening(view.nextTightening, now, pausedUntil);
  const myTeamName = personalId === null ? null : teamName(teamsById(teams), personalId, "Your team");
  const turnWhere = turnLabel(view);
  const pending = pendingPickCount(view);
  // A real BRANCH, not a cosmetic one — the same idiom `useCountdown`'s tick rate already uses.
  // `globals.css`'s reduced-motion block would flatten the animation anyway; not emitting the
  // class at all is what makes the intent legible in the markup rather than only in a stylesheet.
  const reducedMotion = usePrefersReducedMotion();

  return (
    <header
      data-testid="room-rail"
      data-mode={mode}
      className={`flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-2 lg:min-h-20 lg:flex-nowrap ${MODE_SKIN[mode]}`}
    >
      {/* N1/A2 (2026-08-27 flow analysis, "the live draft room has no way out"): the room's own
          way home, unconditional across phase, width and variant — including the TV board, a
          party screen with no keyboard shortcut for browser-back. Two links only, both quiet
          (`text-text-muted`, no weight fight with the turn/clock hierarchy in the rail's right
          group): the wordmark to `/app`, and the league's own name — already the rail's
          masthead — to its league home. Nothing else joins this group; a room's one other exit
          (leaving the draft mid-pick) is a decision this rail does not make for anyone. */}
      <div className="flex min-w-0 items-baseline gap-2">
        {/* RULED (flow-remediation review D-3): the exits obey this rail's own TV invariant
            ("no control on it is ever clickable", below) rather than quietly excepting
            themselves. A TV board is an unattended shared display — one bumped trackpad
            navigating the party away from the board mid-draft is a worse failure than the
            dead end N1 named, and the person who opened that screen still holds the browser
            it opened in. The ROOM variant is where a human sits, and that is where the way
            home belongs. */}
        {variant === "room" ? (
          // The whistle beside the word (founder, 2026-09-04: "there's no navigation" — there
          // WAS, but muted 12px text read as a label, not a door). The mark gives the way home
          // a shape the eye already knows from every other bar; still one link, same href.
          <Link href="/app" className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-text-muted hover:text-text-primary">
            <BrandMark size={16} />
            Commish
          </Link>
        ) : null}
        <h1 className={`min-w-0 truncate font-display font-semibold leading-display text-text-primary ${LEAGUE_TEXT[variant]}`}>
          {variant === "room" ? (
            <Link href={`/app/leagues/${view.leagueId}`} className="hover:underline">
              {leagueName}
            </Link>
          ) : (
            leagueName
          )}
        </h1>
      </div>
      {/* The format's own `InfoTip` is gone (founder ruling, 2026-08-28: "the UX should explain
          itself - we shouldn't need tips"). "Snake draft" is the board's own name for the shape a
          manager is looking at, the board draws the serpentine direction on every round's row
          with an arrow, and the full definition lives at `/league-rules` for whoever wants it. */}
      <Badge tone="neutral">{FORMAT_LABEL[view.format]}</Badge>
      {turnWhere === null ? null : (
        <span data-testid="turn-label" className="inline-flex items-center gap-1.5 font-display text-sm font-semibold tracking-wide text-text-muted">
          {/* Law 6's motion, spent rather than merely obeyed: the clock genuinely is running out,
              and it is running out on YOU. The dot is the product's existing live vocabulary
              (`animate-pulse-live`, built for the live chip) rather than a new animation, and it
              is decorative and `aria-hidden` because the lower third right below says the same
              thing in words. It never pulses a number a manager is reading. */}
          {turn.mine && !reducedMotion ? (
            <span data-testid="on-clock-pulse" aria-hidden="true" className="size-1.5 shrink-0 rounded-pill bg-live animate-pulse-live" />
          ) : null}
          {turnWhere}
        </span>
      )}
      {pending === 0 ? null : (
        // No name, no accusation — the board's own pending cells and each owing manager's own
        // dock already say who; this says only that the draft is waiting on somebody.
        <Badge tone="neutral" data-testid="pending-picks">
          {pending === 1 ? "1 pick pending" : `${pending} picks pending`}
        </Badge>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 lg:flex-nowrap">
        {mode === "scheduled" ? (
          // R2: the waiting story — the trigger-aware sentence quoted off the wire (from
          // `describeStartTiming` for a real league, `MOCK_COPY` for a practice room), and the
          // kickoff countdown whenever a kickoff instant actually exists. The countdown wrapper
          // renders on the TARGET, not on `remainingMs`: `useCountdown` is null for one
          // hydrating frame, and `Countdown`'s own placeholder holds the line box rather than
          // the whole block popping in a frame late.
          <>
            <StaticState detail={waitingInfo?.detail ?? null} />
            {waitingInfo?.kickoffAt == null ? null : (
              <div className="flex flex-col items-end">
                <span className={`${RAIL_EYEBROW[variant]} text-text-muted`}>Starts in</span>
                <Countdown remainingMs={remainingMs} size={RAIL_COUNTDOWN_SIZE[variant]} data-testid="kickoff-countdown" />
              </div>
            )}
          </>
        ) : mode === "complete" ? (
          <StaticState detail="Every roster is final." />
        ) : (
          // WHAT THE MASTHEAD STILL SAYS ABOUT THE CLOCK, once the clock itself moved to the
          // lower third: the two facts that are about the SCHEDULE rather than about this turn.
          // A freeze and a tightening are both statements about how the room's rules change over
          // the next hours, which is masthead work; the sixty seconds in front of you are not.
          <div className="flex flex-col items-end">
            {paused ? (
              <span data-testid="paused-message" className="text-sm font-medium text-warning">
                {formatPausedUntil(pausedUntil!)}
              </span>
            ) : null}
            {tightening === null ? null : <span className={`${TIGHTENING_TEXT[variant]} text-warning`}>{tightening}</span>}
          </div>
        )}
        {/* Suppressed while `hot` — E9 (2026-08-26 design review): "Your team: Turf Burners"
            beside a rail already tinted live said the same thing twice at the exact moment the
            rail should say one thing. The lower third owns the fact while the turn is mine; the
            chip returns the moment it is not. */}
        {myTeamName === null || mode === "hot" ? null : (
          <span className="whitespace-nowrap text-sm text-text-muted">
            Your team: <span className="font-display font-semibold text-text-primary">{myTeamName}</span>
          </span>
        )}
        {/* A finished draft has nothing left to deliver: a connection chip beside
            "Every roster is final" reads as broken, not informative. */}
        {view.phase === "complete" ? null : <ConnectionBanner connection={connection} />}
        {/* Task 16, F13: the room's EXISTING banner slot, beside `ConnectionBanner` — the slot
            this room already uses to say "the connection is not what you think it is". A dead
            session matters here whether or not the draft has finished (a manager reviewing a
            just-finished board can still lose their session), so this renders regardless of
            `view.phase`, unlike `ConnectionBanner` above it. `variant="room"` (Task 12 Step 1b)
            is what makes it read as `ConnectionBanner`'s sibling instead of `TopBar`'s bordered
            strip transplanted into a tight `lg:h-20` row. */}
        <SessionNotice variant="room" />
      </div>
    </header>
  );
}
