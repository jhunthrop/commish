"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import { Button, Crest, EmptyState, Meter, SeatMeter } from "@/components/ui";
import { Countdown, useCountdown } from "@/components/ui/countdown";
import { RoomTour } from "@/draft-room/components/room-tour";
import { actionLabelFor } from "@/draft-room/lib/lookups";
import type { ProfileBody } from "@/account-room/contract";
import type { HelpLevel } from "@/identity/preferences";
import type { PublicLeagueSummary } from "@/matchmaking/contract";
import type { HomeBody, HomeLeagueCard as HomeLeagueCardData } from "../contract";
import { LEAGUE_ROOM_CONFIG } from "../config";
import { useLeagueRoomDeps } from "../hooks/deps";
import { isHomeBody } from "../lib/home-body";
import { openCreateLeagueSheet } from "./create-league-sheet";
import { FirstRunPanel } from "./first-run-panel";
import { LeagueRows } from "./league-rows";
import { OpenSeatsPanel } from "./open-seats-panel";
import { WaitingChecklist } from "./waiting-checklist";
import { checklistItems } from "./waiting-room";

/**
 * Flow analysis C-08 (2026-08-27): "creation is a first-class action near the top of /app for a
 * member with leagues" — `HomeBoard` renders first, directly under `/app`'s own page title, in
 * every non-empty shape it has, so a real, secondary-weight (never competing with the view's one
 * ink action, Sunday Standard rule 5) button at the TOP of whichever shape renders is "near the
 * top of /app" without moving anything else.
 *
 * OPENS THE SHEET DIRECTLY (founder ruling, 2026-09-05: "the same bottom sheet everywhere...
 * when clicking create league anywhere") — `openCreateLeagueSheet()` (`./create-league-sheet.tsx`)
 * reaches the one host `AppShell` mounts for the whole signed-in app, superseding the old
 * `/app#create-league` fragment link into `StartOrJoinDisclosure`'s own inline form.
 */
function CreateLeagueCta() {
  return (
    <Button variant="secondary" size="sm" className="self-start" onClick={() => openCreateLeagueSheet()}>
      Create a league
    </Button>
  );
}

function someWeekInProgress(body: HomeBody): boolean {
  return body.leagues.some((league) => league.weekStatus === "in_progress");
}


/** Every league on the board is still pre-draft — the manager has no games at all, only a
 *  future draft (F18c). */
function allPreDraft(leagues: readonly HomeLeagueCardData[]): boolean {
  return leagues.length > 0 && leagues.every((league) => league.draftStatus === "scheduled");
}

/** The nearest draft among a set of pre-draft leagues: a `when_full` league sorts first — it
 *  could start the moment its last seat lands, which is a nearer fact than any dated kickoff —
 *  and the rest sort by their own real `kickoffAt`. */
function nearestPreDraft(leagues: readonly HomeLeagueCardData[]): HomeLeagueCardData {
  return [...leagues].sort((a, b) => {
    const aWhenFull = a.startTrigger === "when_full";
    const bWhenFull = b.startTrigger === "when_full";
    if (aWhenFull !== bWhenFull) return aWhenFull ? -1 : 1;
    const at = a.kickoffAt === null ? Number.POSITIVE_INFINITY : Date.parse(a.kickoffAt);
    const bt = b.kickoffAt === null ? Number.POSITIVE_INFINITY : Date.parse(b.kickoffAt);
    return at - bt;
  })[0]!;
}

/**
 * The pre-draft home's own hero (Phase 3.6, Task 10, Step 2b): every element real data already
 * on the page — `kickoffAt`/`filledTeams`/`teamCount`/`startTrigger` from the same home read the
 * board uses, and the checklist's items the SAME `checklistItems` (`./waiting-room.tsx`) Task 9
 * Step 4 defines, inlined rather than linked. `slotPreference` is not part of this cross-league
 * read (it is a per-draft, per-team query `crossLeagueHome` does not run for every pre-draft
 * league on the board), so the rank item renders its own stated fact with no control rather than
 * a second, narrower ranking panel invented just for this hero.
 */
function PreDraftHero({
  league,
  remainingMs,
  myTeamName,
  helpLevel,
}: {
  readonly league: HomeLeagueCardData;
  readonly remainingMs: number | null;
  readonly myTeamName: string | null;
  readonly helpLevel: HelpLevel | undefined;
}) {
  const [tourOpen, setTourOpen] = useState(false);
  const items = checklistItems({
    leagueId: league.id,
    myTeamName,
    slotPreference: null,
    helpLevel,
    format: league.format,
    onOpenTour: () => setTourOpen(true),
    // D5: this board never fetches a per-league `slotPreference` (see this hero's own docblock),
    // but every league it renders is one this manager has a real team in — so the honest fix is a
    // real link into the room that DOES have the ranking panel, not dead body text.
    rankHref: `/app/leagues/${league.id}`,
  });

  return (
    <div data-testid="pre-draft-hero" className="flex flex-col gap-4">
      {/* `mx-auto max-w-md` (overflow fix, 2026-09-05): this box used to have no width cap of
       *  its own, so at wide viewports (1440px+) it stretched to the full column while `Meter`
       *  stayed pinned to its own `max-w-xs` — the two disagreed on where "the middle" was, and
       *  `SeatMeter`'s un-capped flex row (its bar is `flex-1`) filled whatever was left, reading
       *  as the seat count sliding away from the league name toward the right edge. One shared
       *  cap on the card means the meter, the countdown, and the seat row all measure from the
       *  same center at any width. */}
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3 rounded-lg border border-dashed border-line p-8 text-center">
        <Crest id={league.id} name={league.name} size={64} />
        <h2 className="font-display text-2xl font-semibold leading-display text-text-primary">{league.name}</h2>
        {league.startTrigger === "when_full" ? (
          <Meter label="Seats filled" value={league.filledTeams} max={league.teamCount} className="w-full max-w-xs" />
        ) : (
          // Null pre-hydration (`useNow`'s contract): the digits hold their placeholder for
          // that one frame rather than a false "0:00".
          <Countdown remainingMs={remainingMs} size="xl" />
        )}
        <SeatMeter filled={league.filledTeams} total={league.teamCount} className="w-full max-w-xs" />
      </div>
      <WaitingChecklist items={items} />
      {tourOpen ? <RoomTour dismissedAt={null} onDismiss={() => setTourOpen(false)} actionLabel={actionLabelFor(league.format)} /> : null}
    </div>
  );
}

/**
 * The cross-league home board: renders the server's payload immediately, then refreshes it on
 * `LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs` — but only while BOTH of two things are true:
 *
 * 1. The document is VISIBLE. A backgrounded tab refreshing every interval all Sunday is
 *    somebody's battery and our request budget for nothing they can see.
 * 2. At least one league's current week is actually `in_progress`. On a Tuesday nothing on this
 *    page can change, so nothing on this page should be asking.
 *
 * This is deliberately not a second real-time transport. Redis Streams over SSE remains the
 * one mechanism, and it is where the per-league live surface lives (`useLiveScores`): a manager
 * in ten leagues cannot hold ten SSE connections (`REALTIME_CONFIG.maxStreamsPerUser` is 6, a league tab costs one of them, and
 * each one pins a Redis socket and an fd server-side), so this view reads a cached summary on an
 * interval instead, and every card links into the league page where the real stream is.
 *
 * The interval itself runs unconditionally once mounted — cheap, since a `setInterval` callback
 * that returns immediately costs nothing — and both conditions are re-checked on EVERY tick
 * against the latest held state (via `bodyRef`), not just at mount: a week that goes final
 * between two ticks stops polling on the very next one, and a tab that comes back into view
 * resumes on its own without a dedicated `visibilitychange` listener.
 *
 * Three shapes, decided by what the leagues actually are (Task 10):
 *   - Zero leagues: `FirstRunPanel` (or the defensive plain empty state).
 *   - Exactly one league: the board IS the league (Step 1's own n=1 test) — a heading and the
 *     ordinary `HomeLeagueCard`, never the multi-league table and never a sort announced over a
 *     list of one.
 *   - Every league pre-draft: the nearest draft's row promoted to a hero (Step 2b) — but with
 *     more than one league, `LeagueRows` still renders beneath it (fix round 2026-09-05: the
 *     hero used to RETURN there, which hid every other league the manager is in from this page
 *     while the shell's rail kept showing all of them — the same read, `crossLeagueHome`, two
 *     different truths). The nearest draft leads; nothing this manager is in disappears. At
 *     n=1 the hero alone is already the whole truth, so nothing renders beneath it.
 *   - Otherwise: `AttentionQueue` above `LeagueBoard`, the dense multi-league table.
 *
 * `OpenSeatsPanel` renders below always, quieter for the single pre-draft manager (Step 4), and
 * not at all when `firstRun !== null` (F18b) — `FirstRunPanel`'s own three paths already open
 * with "find an open league".
 */
export function HomeBoard({
  initial,
  openLeagues = [],
  helpLevel,
  profile = null,
}: {
  readonly initial: HomeBody;
  /** The house shelf's own leagues (`listPublicLeagues`), server-read once by `AppHome` — this
   *  board never fetches them itself. Defaults to `[]` (renders no `OpenSeatsPanel`) so a caller
   *  that predates Step 4 keeps working; `AppHome`/`/api/home`'s own page always supplies it. */
  readonly openLeagues?: readonly PublicLeagueSummary[];
  readonly helpLevel?: HelpLevel;
  /** `FirstRunPanel`'s identity card needs it (Task 17); every other branch this board renders
   *  ignores it entirely. `AppHome` reads it only when `initial.firstRun !== null` (no new data
   *  cost for the common case of a manager who already has leagues) and defaults to `null`
   *  otherwise, same shape as `openLeagues`' own predates-Step-4 default. */
  readonly profile?: ProfileBody | null;
}) {
  const [body, setBody] = useState<HomeBody>(initial);
  const deps = useLeagueRoomDeps();
  const bodyRef = useRef(body);
  bodyRef.current = body;

  const preDraftHero = allPreDraft(body.leagues) ? nearestPreDraft(body.leagues) : null;
  const { remainingMs } = useCountdown(preDraftHero?.startTrigger === "scheduled" ? preDraftHero.kickoffAt : null);

  useEffect(() => {
    let cancelled = false;

    async function tick(): Promise<void> {
      if (document.visibilityState !== "visible") return;
      if (!someWeekInProgress(bodyRef.current)) return;
      try {
        const response = await deps.fetchJson("/api/home");
        const envelope = (await response.json()) as ApiEnvelope<unknown>;
        if (cancelled || !envelope.ok || !isHomeBody(envelope.data)) return;
        setBody(envelope.data);
      } catch {
        // A failed background refresh leaves the last-known state on screen — the page already
        // rendered real data from the server, and this loop exists to keep it moving, not to be
        // the thing that can break the page.
      }
    }

    const interval = setInterval(() => void tick(), LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [deps]);

  if (body.leagues.length === 0) {
    if (body.firstRun !== null && profile !== null) return <FirstRunPanel plan={body.firstRun} profile={profile} />;
    // Defensive only: `firstRunPlan` (@/identity/first-run.ts) returns `null` exactly when
    // `leagueCount > 0`, so a caller that computed `firstRun` from the same league count this
    // board renders can never reach this branch. It stays as a fail-safe rather than an assumed
    // invariant, since nothing in `HomeBody`'s own type ties the two fields together. `profile
    // === null` joins it for the same reason: `AppHome` only skips the read when `firstRun` is
    // already `null`, so a `firstRun`-but-no-`profile` combination is equally unreachable in
    // practice — this still renders something real rather than crashing if it ever happened.
    return (
      <EmptyState
        title="No leagues yet"
        description="Create one below, or open an invite link a commissioner sent you."
        icon="users"
        action={
          <button
            type="button"
            onClick={() => openCreateLeagueSheet()}
            className="text-sm font-medium text-accent underline"
          >
            Start a league
          </button>
        }
      />
    );
  }

  const openSeats =
    body.firstRun !== null ? null : <OpenSeatsPanel leagues={openLeagues} quiet={body.leagues.length === 1} />;

  if (preDraftHero !== null) {
    return (
      <div className="flex flex-col gap-6">
        <CreateLeagueCta />
        <PreDraftHero league={preDraftHero} remainingMs={remainingMs} myTeamName={preDraftHero.myTeamName} helpLevel={helpLevel} />
        {/* The nearest draft leads, but a manager in more than one league still sees every one
         *  of them below it — the same `LeagueRows` the non-pre-draft branch renders (this fix,
         *  2026-09-05). At n=1 the hero above already IS the whole truth, so nothing repeats it. */}
        {body.leagues.length > 1 ? <LeagueRows leagues={body.leagues} /> : null}
        {openSeats}
      </div>
    );
  }

  // THE RAIL AT FULL PAGE (the rail redesign, 2026-09-03): one branch for one league or ten —
  // `LeagueRows` is the same row model the rail's flyout renders, with per-row verbs, and its
  // urgency order IS the page's answer to "which of my leagues needs me right now". The old
  // board's three tellings of that answer (`AttentionQueue`'s chips, `LeagueBoard`'s sort,
  // `BoardLowerThird`'s counts-and-verb) collapsed into it — the spec's law-4 accounting names
  // what each column became, and the amber budget holds by construction: the rows' one solid
  // verb is the page's only solid.
  return (
    <div className="flex flex-col gap-6">
      <CreateLeagueCta />
      <LeagueRows leagues={body.leagues} />
      {openSeats}
    </div>
  );
}
