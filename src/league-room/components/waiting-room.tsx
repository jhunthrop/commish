"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BigNumber, Celebration, ManagerStack, type StackedManager } from "@/components/ui";
import { Countdown, formatCoarseDuration, useCountdown } from "@/components/ui/countdown";
import { UI_CONFIG } from "@/components/ui/config";
import { SeatMeter } from "@/components/ui/seat-meter";
import { StatePanel } from "@/components/ui/state-panel";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { actionLabelFor } from "@/draft-room/lib/lookups";
import { RoomTour } from "@/draft-room/components/room-tour";
import type { DraftFormat } from "@/domain/league";
import type { HelpLevel } from "@/identity/preferences";
import type { LeagueAuthority } from "@/league-service/authority";
import { hasOpenSeat } from "@/matchmaking/filter";
import { describeStartTiming } from "@/matchmaking/roll";
import type { CompositionCategory } from "@/participation/composition";
import type { DraftScheduleBody, LeagueMemberCard } from "../contract";
import { useReaderClock } from "../hooks/use-reader-clock";
import { instantWeekday, type ReaderClock } from "../lib/day-chapters";
import { DraftSchedulePanel, draftTerminalStatePanel } from "./draft-schedule-panel";
import { alreadyInPhrase } from "./open-league-shared";
import { ReleaseSeatControl } from "./release-seat-control";
import { RoomRoster } from "./room-roster";
import { SlotPreferencePanel } from "./slot-preference-panel";
import { WaitingChecklist, type WaitingChecklistItem } from "./waiting-checklist";

/**
 * `DraftScheduleBody` plus the two facts Task 8's own "Produces" list deliberately does not add
 * there (`DraftScheduleBody.startTrigger`/`filledTeams` are the only two new fields it names):
 * `teamCount` rides in from `LeagueHomeBody`, which `LeagueHome` already holds for its own
 * header line, rather than a third copy of a league's own seat count on the wire. `authority`
 * (Phase 3.5 addendum, Task 14) is the SAME `LeagueHomeBody.authority` Task 12's wire type
 * carries — this component reads its `kind` directly, rather than trusting a page-local
 * `isHouse` boolean a caller could compute wrong, to decide which of the two filling-state
 * actions a house league can actually offer.
 */
export interface WaitingRoomLeague extends DraftScheduleBody {
  readonly teamCount: number;
  readonly authority: LeagueAuthority;
  /**
   * Gauntlet fix wave, NEW-8: `draftTerminalStatePanel`'s expiry window needs the season's
   * current week — `LeagueHome` already holds it for its own header line, the same "rides in as
   * a prop rather than widening the wire body" precedent `teamCount`/`authority` above set.
   * Optional, defaulting to `1` (inside the window) at every read site, so every fixture and
   * caller that predates this task — none of which had a season to be deep into — keeps its old
   * behavior unchanged.
   */
  readonly currentWeek?: number;
  /** `draftTerminalStatePanel`'s expiry window's other half — `home.totalWeeks`. Same optional,
   *  same `1` default, same "predates this task" reasoning `currentWeek` above carries. */
  readonly totalWeeks?: number;
}

/**
 * "Thursday" from a real, given instant — never the ambient clock (flow-remediation review D-1:
 * `toLocaleDateString(undefined, …)` used to render this weekday in the browser's timezone while
 * the terms panel one screen away rendered the same instant in UTC, so a reader east of UTC could
 * see two different days for one draft — C-02's own defect, on the surface the sweep missed).
 *
 * 2026-09-11 fix round: routed through `instantWeekday` (`../lib/day-chapters`), the SAME
 * `formatToParts` call `absoluteInstant` reads for every other draft-date surface, off the SAME
 * `useReaderClock` this room's own `DraftSchedulePanel` hero now reads — UTC (D-1's fixed
 * convention) until the reader's clock resolves, their own zone after, so this sentence's day and
 * `DraftSchedulePanel`'s time can never name two different zones for the one instant again.
 *
 * The unparseable-instant guard survives the move: `instantWeekday` formats whatever it is given
 * and an invalid date throws inside `Intl`, so a kickoff this room could not read renders as
 * absence (the empty string it always rendered), never as a crashed panel.
 */
function weekdayOf(iso: string, clock: ReaderClock | null): string {
  if (Number.isNaN(Date.parse(iso))) return "";
  return instantWeekday(iso, clock);
}

/**
 * The four checklist items, in the order that helps most (Phase 3.6, Task 9, Step 4): a
 * first-timer (`helpLevel === "guided"`) gets the room tour first; a manager with a season behind
 * them gets it last, because the highest-value item for someone who has never drafted is the
 * lowest-value item for someone who has. Every item's `content` is a real, working control —
 * never a link that only describes what the click would do (`first-run-panel.tsx`'s own rule).
 *
 * "Name your team" and "Turn on notices" have no dedicated write path in this product today (no
 * team-rename endpoint, no per-user notification toggle — every in-app notice is already live for
 * everyone, `@/identity/notifications`'s own docblock), so both state the real, current fact
 * rather than offering a control this codebase cannot yet honor.
 */
/** Exported at its second caller (Phase 3.6, Task 10, Step 2b): the pre-draft home's own hero
 *  inlines this exact function rather than a second, narrower item list — "no new component that
 *  exists only here." */
export function checklistItems(params: {
  readonly leagueId: string;
  readonly myTeamName: string | null;
  readonly slotPreference: DraftScheduleBody["slotPreference"];
  readonly helpLevel: HelpLevel | undefined;
  readonly format: DraftFormat;
  readonly onOpenTour: () => void;
  /**
   * D5 (flow analysis, 2026-08-27): the pre-draft home board (`PreDraftHero`, `./home-board.tsx`)
   * deliberately does not fetch a per-league `slotPreference` for its cross-league read (its own
   * docblock) — that caller always has a real team in every league it renders, so its "rank"
   * item's absent `content` is a cost decision, not a "there is nothing to rank" fact. Passing
   * this turns the item into a real, working link into the room that DOES have the ranking panel,
   * rather than dead body text with no action at all. Left `undefined` by `WaitingRoom`'s own call
   * site: there, a `null` `slotPreference` can genuinely mean "no team here" (a commissioner
   * without one of their own), for whom a "go rank" link would be a lie.
   */
  readonly rankHref?: string;
}): readonly WaitingChecklistItem[] {
  const tour: WaitingChecklistItem = {
    key: "tour",
    heading: "See how the draft room works",
    body: "The clock, the queue and a pick, before any of it counts.",
    // Task 9, Step 1 (row 18's ask): a guided preview of THIS room, and a real mock draft
    // against seeded bots, side by side — the tour describes the room, the practice link lets a
    // manager actually run one before it counts. `/app/mock-drafts?create=solo` is `DraftRoom`'s
    // own "Run it again" contract (`@/draft-room/components/draft-room.tsx`'s `MOCK_LOBBY_PATH`
    // docblock): immediate solo creation, straight into the room, never the lobby first.
    content: (
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" className="text-sm font-medium text-accent underline" onClick={params.onOpenTour}>
          Preview the room
        </button>
        <Link href="/app/mock-drafts?create=solo" className="text-sm font-medium text-accent underline">
          Run a mock draft
        </Link>
      </div>
    ),
  };
  // D5: "Name your team" reads as an instruction with no control behind it — no rename endpoint
  // exists anywhere in this codebase (`docs/research/2026-08-27-journey-commissioner.md`, C-07).
  // Rephrased away from the imperative rather than left promising an action nobody can take;
  // the fact itself is unchanged. "Team name", not the possessive "Your team's name": this room
  // also renders for a house register with zero contractions or possessive apostrophes anywhere
  // on screen (`waiting-room.test.tsx`'s own sweep, which cannot tell a possessive `'s` apart
  // from a contraction and is right not to try).
  const name: WaitingChecklistItem = {
    key: "name",
    heading: "Team name",
    body:
      params.myTeamName === null
        ? "Every team here is named."
        : `Your team is named ${params.myTeamName}. That is what the rest of the room will call you all season.`,
  };
  const rank: WaitingChecklistItem = {
    key: "rank",
    heading: "Rank your draft slots",
    body: "A higher choice wins more often than luck alone.",
    content:
      params.slotPreference !== null ? (
        <SlotPreferencePanel leagueId={params.leagueId} initialPreference={params.slotPreference} />
      ) : params.rankHref !== undefined ? (
        <Link href={params.rankHref} className="text-sm font-medium text-accent underline">
          Rank your slots in the league room
        </Link>
      ) : undefined,
  };
  const notices: WaitingChecklistItem = {
    key: "notices",
    heading: "Turn on notices",
    body: "Already on for every league you are in.",
    content: (
      <Link href="/app/profile#notifications-heading" className="text-sm font-medium text-accent underline">
        See what you will hear about
      </Link>
    ),
  };
  const firstTimer = params.helpLevel === "guided";
  return firstTimer ? [tour, name, rank, notices] : [name, rank, notices, tour];
}

export interface WaitingRoomProps {
  readonly league: WaitingRoomLeague;
  readonly isCommissioner?: boolean;
  /** Phase 3.6, Task 8: `ReleaseSeatControl`'s own Modal names the league by name, never by id —
   *  rides in as a separate prop rather than a third copy of a league's own name on the wire, the
   *  same reasoning `teamCount` already sets a precedent for on this component. Optional (default
   *  `""`, never rendered on its own): every existing caller that predates this task never has to
   *  supply a name it never asked about, the same "absent means never in play" shape
   *  `holdOutcome` already keeps on `JoinLeagueOutcome`. */
  readonly leagueName?: string;
  /** `null` only for a caller with no team here (a commissioner without one of their own), and
   *  the default for every caller that predates this task — the same shape
   *  `LeagueHomeBody.myTeamId` already carries. Nothing to release without a seat, so `null`
   *  simply never renders `ReleaseSeatControl` at all. */
  readonly myTeamId?: string | null;
  /**
   * D1, the seating moment (Task 9, Step 2b): derived server-side (`LeagueHomeBody.justSeated`)
   * from the caller's own `member_joined` moment against an injected `Clock`, never `Date.now()`
   * here. `false` by default — every caller that predates this task never has to reason about it.
   */
  readonly justSeated?: boolean;
  /**
   * The `?holdExpired=1` carry (Task 6, binding). CALLER-FORGEABLE and decorative only: it may
   * soften the seating moment's copy, and it decides nothing about capacity, identity or state.
   */
  readonly holdExpired?: boolean;
  /** For the room tour's own button label — "Draft" for snake, "Nominate" for auction
   *  (`actionLabelFor`, `@/draft-room/lib/lookups`). Defaults to the more common format so a
   *  caller that predates this task's checklist never has to supply it. */
  readonly format?: DraftFormat;
  /** `RoomRoster`'s own list. `undefined` renders no roster at all — a caller that has not yet
   *  paid for the members read (none predate this task) is never shown half a room. */
  readonly teams?: readonly LeagueMemberCard[];
  /** Ruling 19: the room's coarse composition, never the raw counts. */
  readonly compositionCategory?: CompositionCategory;
  readonly helpLevel?: HelpLevel;
  /**
   * Task 12 fix round 1 (F1): the SAME derived flag `LeagueHome` computes for its own
   * `DraftCompleteArrival` (Step 3b, D4) — threaded rather than re-derived, since this
   * component has no `currentWeek`/`myMatchup` of its own to derive it from, and a second copy
   * of that predicate is exactly the kind of drift risk the codebase's own "centralize the
   * first time" discipline exists to avoid. `false` by default, so every caller that predates
   * this flag keeps rendering the terminal panel exactly as before. See this component's own
   * terminal branch below for what it suppresses and why.
   */
  readonly draftJustCompleted?: boolean;
}

/**
 * The room, before there is a draft to watch (Phase 3.6, Task 9 — v2's rewrite of Phase 3.5
 * Task 8's four `StatePanel`s). Renders for EVERY pre-draft league now, not only a `when_full`
 * one: `LeagueHome` hands this component `home.draftSchedule` whole and lets it decide the hero,
 * the structural change this task owns (F12/P8) — a `'scheduled'`-trigger league delegates its
 * own hero and commissioner console to `DraftSchedulePanel`, nested here rather than rendered as
 * a sibling `LeagueHome` chooses between.
 *
 * Two hero variants for a `'scheduled'` trigger and a `'when_full'` one (Step 2): a scheduled
 * league always has a real `kickoffAt`, so its hero is always the `xl` `Countdown` beside the
 * fill `SeatMeter` (`DraftSchedulePanel`'s own hero, Task 9's addition to it); a `when_full`
 * league's `kickoffAt` is a placeholder until the room fills, so its hero is the fill `SeatMeter`
 * PROMOTED — no countdown at all — until the last seat lands, at which point (D3) the meter
 * completes, the seat sentence settles to "N of N seated", and the `xl` `Countdown` to the
 * grace-window kickoff replaces it as the hero, in that order. Under `prefers-reduced-motion`
 * that sequencing collapses to nothing: the meter completes and the countdown appears with no
 * transition at all.
 *
 * Five more states beyond the two heroes: the two terminal ones (`draftTerminalStatePanel`,
 * shared with `DraftSchedulePanel` so the two can never phrase them differently), the missed-draft
 * variant of "complete" (`league.missedDraft`), the just-seated moment (`justSeated`, D1), and,
 * once none of those apply, the room itself — the hero, `RoomRoster` (Step 3) and
 * `WaitingChecklist` (Step 4) together.
 */
export function WaitingRoom({
  league,
  isCommissioner = false,
  leagueName = "",
  myTeamId = null,
  justSeated = false,
  holdExpired = false,
  format = "snake",
  teams,
  compositionCategory = "open",
  helpLevel,
  draftJustCompleted = false,
}: WaitingRoomProps) {
  const isHouse = league.authority.kind === "house";
  const full = !hasOpenSeat(league);
  // A member-league commissioner can never release (`RELEASE_REFUSALS.commissioner` — no
  // transfer-of-commissioner path), so the control is not offered to them at all rather than
  // shown and always refused. A house league never sets `isCommissioner` true in the first place
  // (`isCommissionerOf`'s own docblock), so this reads correctly for both authorities without a
  // second branch on `league.authority.kind`.
  const canRelease = myTeamId !== null && !isCommissioner;
  const reducedMotion = usePrefersReducedMotion();
  const [tourOpen, setTourOpen] = useState(false);

  // D3: the meter-then-countdown sequencing, tracked across renders — `full` flips from false to
  // true exactly once, the instant the last seat lands, and this is what makes the hero VISIBLY
  // change state rather than quietly rerendering a different number. Initialized to `full` itself
  // so a caller that mounts this component already full (the ordinary case — a page render, not
  // a live transition) skips the pause entirely and shows the countdown immediately.
  const [showCountdownHero, setShowCountdownHero] = useState(full);
  const wasFullRef = useRef(full);
  useEffect(() => {
    if (!wasFullRef.current && full) {
      if (reducedMotion) {
        setShowCountdownHero(true);
      } else {
        setShowCountdownHero(false);
        const timer = setTimeout(() => setShowCountdownHero(true), UI_CONFIG.waitingRoom.fillCelebrationMs);
        wasFullRef.current = full;
        return () => clearTimeout(timer);
      }
    }
    wasFullRef.current = full;
  }, [full, reducedMotion]);

  // Called unconditionally, before any early return — React's Rules of Hooks. `null` once
  // there's nothing left to count down to: a `when_full` league still filling has no real
  // `kickoffAt` yet (`DraftScheduleBody.kickoffAt`'s own docblock).
  const { remainingMs } = useCountdown(league.startTrigger === "when_full" && full ? league.kickoffAt : null);
  // Also unconditional, same rule: the missed-draft sentence below reads it for `instantWeekday`.
  const clock = useReaderClock();

  const myTeam = teams?.find((team) => team.id === myTeamId) ?? null;
  const myTeamName = myTeam?.name ?? null;
  /**
   * WHO IS IN THIS ROOM, as people (P1). Unlike the public shelf — where `PublicLeagueSummary`
   * forbids naming anybody (`SeatStack`'s docblock) — a member reading their own waiting room
   * already sees this roster below, so the stack at the top is the same fact, faces first.
   * Your own seat leads and wears the amber ring. `undefined` teams means the caller never paid
   * for the members read, and an absent stack is absence, never four invented circles.
   */
  const seated: readonly StackedManager[] =
    teams === undefined
      ? []
      : [...teams]
          .sort((a, b) => Number(b.id === myTeamId) - Number(a.id === myTeamId))
          .map((team) => ({ name: team.ownerDisplayName, avatar: team.ownerAvatarUrl, isSelf: team.id === myTeamId }));
  // "9 already in.", never "9 of 12 seated": `SeatMeter` owns THE seat sentence for the product
  // (F17) and says it on this same hero. The stack's caption is about the PEOPLE, through the
  // one phrase the open-league row also reads (`alreadyInPhrase`, fix round 1's L3 — this file
  // used to build the same words without the period), so the two never drift or say one fact
  // twice.
  const seatedCaption = alreadyInPhrase(league.filledTeams);
  const items = checklistItems({
    leagueId: league.leagueId,
    myTeamName,
    slotPreference: league.slotPreference,
    helpLevel,
    format,
    onOpenTour: () => setTourOpen(true),
  });

  // e2e checkpoint fix round (reconciliation, P9-P11 checkpoint): `SlotPreferencePanel` renders
  // nothing until `preference.canEdit` is false (`slot-preference-panel.tsx`'s own gate), which
  // only happens once `draft.status` moves past `"scheduled"` (`slotPreferenceViewFor`,
  // `@/league-service/draft-schedule.ts`) — exactly the states `draftTerminalStatePanel` and the
  // `missedDraft` branch below short-circuit BEFORE the checklist (and this panel inside it) is
  // ever reached. Pre-Task-9, `SlotPreferencePanel` was `LeagueHome`'s own unconditional sibling
  // (never gated on draft status at all), so the post-draw result sentence ("You ranked slot N
  // first and you got slot N.") was always visible once the draw ran. Task 9's inlining made that
  // sentence structurally unreachable — a real regression, not a copy move — so it is carried
  // here, independent of which early return below fires, restoring the pre-Task-9 guarantee.
  const slotPreferenceResult = items.find((item) => item.key === "rank")?.content ?? null;

  // e2e checkpoint fix round (reconciliation, P9-P11 checkpoint), second real gap: D1 (the
  // just-seated congratulatory panel, below) and D3 (this meter-then-countdown hero) were built
  // independently and never reasoned about the one case where they collide — a `when_full`
  // league's LAST seat, filled live. That join is simultaneously the fill event (D3: the room is
  // now full, `kickoffAt` becomes real, the grace window starts) and the join event (D1: the
  // filler is `justSeated`), and `justSeatedMinutes` (5) happens to equal
  // `MATCHMAKING_CONFIG.sitAndGo.graceSeconds` in minutes (5) — so, unfixed, the ONE manager whose
  // own click started the countdown was the one manager who could not see it for the entire grace
  // window, stuck on a generic "you're in" card while everyone else who loads the page gets the
  // real hero. Extracted so D1 can show the SAME hero, not a second copy that could drift from
  // it — `showCountdownHero` is already `true` on this render (its `useState(full)` initializer),
  // so no animation is skipped or duplicated by reusing it here.
  const fullSeatHero: ReactNode =
    full && league.startTrigger === "when_full" ? (
      <div data-testid="waiting-room-hero" className="flex flex-col items-start gap-3 rounded-xl bg-surface-elevated p-6 shadow-card">
        {/* P1 then P2: the room's people, then its one number with its basis. */}
        {seated.length === 0 ? null : <ManagerStack people={seated} caption={seatedCaption} />}
        {/* `filledTeams`, not `teamCount` (fix round 1, L2): the fact is how many seats are
            taken, and printing capacity was only ever right while "full" meant exactly filled.
            The basis names the population, so the two numbers are read together. */}
        <BigNumber value={String(league.filledTeams)} basis={`of ${league.teamCount} seats taken`} size="lg" align="start" />
        <SeatMeter filled={league.filledTeams} total={league.teamCount} srOnlySentence className="w-full" />
        {showCountdownHero ? (
          <div className="flex flex-col items-center gap-1">
            {/* `remainingMs` is null on the server and hydrating renders (`useNow`'s hydration
                contract): the digits hold their placeholder and the status line stays empty for
                that one frame — never a false "Starts in under a minute." computed from a 0
                nobody's clock produced. */}
            <Countdown remainingMs={remainingMs} size="xl" data-testid="waiting-room-countdown" />
            <p role="status" className="text-sm text-text-muted">
              {remainingMs === null ? null : `Starts in ${formatCoarseDuration(remainingMs)}.`}
            </p>
            {/* First-timer persona question, Step 5/6: "what happens if I'm not there?" —
                answered honestly, in C3's own phrasing, once the clock is actually running. */}
            <p className="text-sm text-text-muted">Away when it starts? The room picks for you: your queue first, then the best player your roster needs.</p>
          </div>
        ) : null}
      </div>
    ) : null;

  const terminal = draftTerminalStatePanel(league, league.currentWeek ?? 1, league.totalWeeks ?? 1);
  if (terminal !== null && !league.missedDraft) {
    // Task 12 fix round 1 (F1): `LeagueHome`'s own `DraftCompleteArrival` (Step 3b, D4) already
    // shows this exact "draft complete" moment, more richly, during its own window — this
    // panel's plain "Draft complete / Every roster is set / View the draft board" card would
    // double the message right at the delight beat. Suppressed for that window only (never for
    // `in_progress`, which `draftJustCompleted` is never true alongside — see its own docblock);
    // `DraftCompleteArrival` folds in the one thing this panel said that it didn't already say
    // (the "View the draft board" link), so nothing is lost. `slotPreferenceResult` is unrelated
    // to D4 and keeps rendering either way. The permanent panel returns on its own the moment
    // `draftJustCompleted` goes false again — `LeagueHome` stops passing it true once the season
    // has a result, the same self-expiry `DraftCompleteArrival` already has.
    if (draftJustCompleted && league.status === "complete") {
      return slotPreferenceResult === null ? null : <div className="flex flex-col gap-4">{slotPreferenceResult}</div>;
    }
    return (
      <div className="flex flex-col gap-4">
        {terminal}
        {slotPreferenceResult}
      </div>
    );
  }

  // C3: the safety net has one phrasing, "the room picks for you: your queue first, then the
  // best player your roster needs", quoted here (tense-adapted)
  // verbatim (`docs/design-system.md`, Task 14 Step 2) rather than composed a second way.
  if (league.missedDraft) {
    return (
      <div className="flex flex-col gap-4">
        <StatePanel
          tone="neutral"
          icon="check"
          title="Draft complete"
          description={`The draft ran on ${weekdayOf(league.kickoffAt, clock)} and the room picked for you: your queue first, then the best player your roster needed.`}
          action={
            <Link href={`/app/drafts/${league.draftId}`} className="text-sm font-medium text-accent underline">
              See your roster
            </Link>
          }
        />
        {slotPreferenceResult}
      </div>
    );
  }

  // D1: the seating moment — now P8's CELEBRATION FRAME, the primitive, rather than a card this
  // file drew itself. The frame carries what P8 asks of a moment worth screenshotting: which
  // league, the person, the number that earned it with its basis, and the date. Tailgate's
  // slap-in rides it at celebration scale only, which is the borrowing section 5 sanctions, and
  // `Celebration`'s reduced-motion branch is a real one. The hand-rolled crest-and-heading card
  // it replaces said the same three facts in three different registers.
  if (justSeated) {
    const next = items[0]!;
    return (
      <div className="flex flex-col gap-3">
        <Celebration
          testId="just-seated"
          emphasis="self"
          leagueName={leagueName}
          title="You're in"
          detail={`You claimed seat ${league.filledTeams} of ${league.teamCount} just now.`}
          people={myTeam === null ? undefined : [{ name: myTeam.ownerDisplayName, avatar: myTeam.ownerAvatarUrl }]}
          figure={{ value: String(league.filledTeams), basis: `of ${league.teamCount} seats` }}
        />
        {holdExpired ? (
          <p className="text-sm text-text-muted">Your hold ran out, so we seated you the ordinary way.</p>
        ) : null}
        {/* The fill-and-join collision (above): this manager's own join is what started the
            clock, so they see it too, not just the generic next-step hint below. */}
        {fullSeatHero}
        <p className="text-sm text-text-muted">{`${next.heading}. ${next.body}`}</p>
      </div>
    );
  }

  const hero: ReactNode =
    league.startTrigger === "scheduled" ? (
      <DraftSchedulePanel
        leagueId={league.leagueId}
        isCommissioner={isCommissioner}
        initialSchedule={league}
        teamCount={league.teamCount}
        leagueName={leagueName}
        myTeamId={myTeamId}
        currentWeek={league.currentWeek ?? 1}
        totalWeeks={league.totalWeeks ?? 1}
      />
    ) : full ? (
      <div className="flex flex-col gap-2">
        {fullSeatHero}
        {canRelease ? (
          <div className="flex justify-center">
            <ReleaseSeatControl leagueId={league.leagueId} leagueName={leagueName} kickoffRolls={league.kickoffRolls} />
          </div>
        ) : null}
      </div>
    ) : (
      <div className="flex flex-col gap-2">
        <div data-testid="waiting-room-hero" className="flex flex-col items-start gap-3 rounded-xl bg-surface-elevated p-6 shadow-card">
          {/* P1 then P2 (SIDELINE, 2026-09-10): the people in this room, then the one number
              that says what it is waiting for, with its basis. The dashed placeholder box and
              the decorative `users` glyph both retire: a room with real managers in it is not a
              placeholder, and an icon above a seat count is a picture of the words under it. */}
          {seated.length === 0 ? null : <ManagerStack people={seated} caption={seatedCaption} />}
          <BigNumber
            value={String(league.teamCount - league.filledTeams)}
            basis={`${league.teamCount - league.filledTeams === 1 ? "seat" : "seats"} left of ${league.teamCount}`}
            size="lg"
            align="start"
          />
          <SeatMeter filled={league.filledTeams} total={league.teamCount} srOnlySentence className="w-full" />
          {/* F9/C5: quoted from `describeStartTiming`, never typed here — the browse card, this
              room, the schedule panel and the notice all say this one sentence. */}
          <p className="text-sm text-text-muted">{describeStartTiming({ startTrigger: "when_full", authority: league.authority.kind })}</p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            {isHouse || !isCommissioner ? null : (
              <Link href={`/app/leagues/${league.leagueId}#invite-managers`} className="text-sm font-medium text-accent underline">
                Invite someone
              </Link>
            )}
            <Link href="/browse" className="text-sm font-medium text-accent underline">
              {isHouse ? "See the rest of the shelf" : "See leagues closer to filling"}
            </Link>
          </div>
        </div>
        {canRelease ? (
          <div className="flex justify-center">
            <ReleaseSeatControl leagueId={league.leagueId} leagueName={leagueName} kickoffRolls={league.kickoffRolls} />
          </div>
        ) : null}
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      {hero}
      {teams === undefined ? null : (
        <RoomRoster
          leagueId={league.leagueId}
          teams={teams}
          teamCount={league.teamCount}
          myTeamId={myTeamId}
          compositionCategory={compositionCategory}
          canInvite={!isHouse && isCommissioner}
        />
      )}
      <WaitingChecklist items={items} />
      {tourOpen ? <RoomTour dismissedAt={null} onDismiss={() => setTourOpen(false)} actionLabel={actionLabelFor(format)} /> : null}
    </div>
  );
}
