"use client";

import { useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { DraftScheduleBody } from "../contract";
import { Button, Input, SeatMeter } from "@/components/ui";
import { StatePanel } from "@/components/ui/state-panel";
import { Countdown, formatCoarseDuration, useCountdown } from "@/components/ui/countdown";
import { PUBLIC_ROOM_SHORT_REFUSAL, rollNoticeSentence } from "@/matchmaking/roll";
import { formatDraftAbsolute } from "../lib/format";
import { useLeagueRoomDeps } from "../hooks/deps";
import { ReleaseSeatControl } from "./release-seat-control";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/**
 * "Saturday 12 September, 7:00 PM UTC" — flow analysis C-02's fix. Used to read the browser's
 * OWN local clock (`toLocaleString`, no zone label) while `LeagueTerms.draftAt` — the exact
 * string the league's terms panel and the invite landing a stranger reads both already render —
 * used the fixed, zone-labelled UTC convention: one league, two different calendar days on one
 * screen. `formatDraftAbsolute` (`../lib/format`) is the SAME formatting rule
 * `formatAbsoluteTime` (`@/league/terms.ts`) already applies server-side, so this hero now says
 * the identical sentence every other surface that names this draft's time does. `new Date(iso)`
 * parses a real, GIVEN instant — never the ambient clock.
 */
function formatLocal(iso: string): string {
  return formatDraftAbsolute(iso);
}

/**
 * "in 3 days" / "in 5 hours" / "in 20 minutes" / "starting any moment" — never negative: once a
 * kickoff is in the past the draft has either started (a different `status`) or Task 7's own
 * auto-start is about to catch it, so there is no "3 hours ago" this panel needs to word.
 *
 * Built on the shared `formatCoarseDuration` (`@/components/ui/countdown`) rather than this
 * panel's own second copy of the same minute/hour/day rounding — the same "in " sentence
 * `formatCoarseDuration`'s own docblock already generalized itself for (Phase 3.6, Task 3).
 */
function formatRelativeCountdown(msUntil: number): string {
  if (msUntil <= 0) return "starting any moment";
  return `in ${formatCoarseDuration(msUntil)}`;
}

/**
 * "3 seats are still open. Starting now drafts a short league." / "1 seat is still open.
 * Starting now drafts a short league." (Task 7, Step 3) — the warning a PRIVATE commissioner's
 * manual press gets rather than a refusal: a private commissioner has no other way to ever draft
 * if their twelfth friend never signs up, so their button stays live and honest about what
 * pressing it does instead. Fix round 1, M5 (controller ruling): a PUBLIC MATCHMADE MEMBER
 * league's commissioner gets `PUBLIC_ROOM_SHORT_REFUSAL` here instead — see that constant's own
 * docblock (`@/matchmaking/roll`) for why the founder's ruling DOES bind that press.
 */
function shortRoomWarning(openSeats: number): string {
  const seat = openSeats === 1 ? "seat is" : "seats are";
  return `${openSeats} ${seat} still open. Starting now drafts a short league.`;
}

/** `<input type="datetime-local">`'s own value format — no timezone, read and written in
 *  whatever zone the browser is already in, which is exactly the zone `formatLocal` above
 *  displays in. */
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The `in_progress`/`complete` states, identical regardless of HOW the draft's kickoff came to
 * be decided — a commissioner's own chosen time or Task 7's sit-and-go fill trigger. `null` for
 * `scheduled`, the one status this panel does not render on its own.
 *
 * `WaitingRoom` (`./waiting-room`, Task 8, `when_full` leagues) renders these exact same two
 * states through this function rather than a second copy of the same two sentences that could
 * drift from this one — the identical "centralize at the second/third caller" reasoning
 * `@/components/ui/countdown` is built on.
 *
 * Gauntlet fix wave, NEW-8: `"complete"` used to render this card FOREVER — a bare
 * `schedule.status === "complete"` predicate with no expiry, so a league well into its season
 * (the report's example: week 14) still showed "Draft complete / Every roster is set" as the
 * largest block above the matchup. `LeagueHome`'s own `DraftCompleteArrival` (D4) already
 * self-expires (its own window is `currentWeek === 1`, the delight beat); this card's job is
 * different — it is the ordinary, load-bearing way to reach the draft board before the season
 * finds some other one, which is why its own window is the whole regular season rather than D4's
 * single week: a member two months in still legitimately wants "View the draft board" reachable
 * from here. What it may not do is outlive the season it was drafted for.
 *
 * `totalWeeks` (never `LEAGUE_CONFIG.regularSeasonWeeks` imported directly) for the same reason
 * `teamCount` rides in as a prop rather than a shared import elsewhere in this file: client room
 * code goes through the HTTP/SSE boundary only (`eslint.config.mjs`'s client-boundary rule), and
 * `LeagueHomeBody.totalWeeks` is already this exact number, server-derived
 * (`seasonProgress(matchups, LEAGUE_CONFIG.regularSeasonWeeks)`, `@/league-service/read.ts`).
 */
export function draftTerminalStatePanel(
  schedule: Pick<DraftScheduleBody, "status" | "draftId">,
  currentWeek: number,
  totalWeeks: number,
): ReactNode | null {
  if (schedule.status === "complete") {
    if (currentWeek > totalWeeks) return null;
    // GAMEDAY, LAW 4: *"space separates kinds of information; it never exists to calm."* This was
    // a centred `StatePanel` — an icon, a heading and a caption inside 32px of padding — sitting
    // above the week band for the WHOLE regular season to report a fact that stopped changing in
    // August. A settled fact earns a line, not a hero. The `in_progress` state below keeps its
    // panel, because a draft happening RIGHT NOW is the loudest thing that can be true about a
    // league and the two states are not the same kind of news.
    //
    // Nothing is lost: the sentence and the link are the same words in the same order, and the
    // link is still the ordinary, load-bearing way to reach the board all season.
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
        <span>Draft complete. Every roster is set.</span>
        <Link className="font-medium text-accent underline" href={`/app/drafts/${schedule.draftId}`}>
          View the draft board
        </Link>
      </p>
    );
  }
  if (schedule.status === "in_progress") {
    return (
      <StatePanel
        tone="neutral"
        icon="users"
        title="The draft is live"
        description="Picks are happening right now."
        action={
          <Link className="text-sm font-medium text-accent underline" href={`/app/drafts/${schedule.draftId}`}>
            Join the draft
          </Link>
        }
      />
    );
  }
  return null;
}

/**
 * The button that has existed since Phase 1 and nobody could ever press on purpose
 * (`POST /api/drafts/[draftId]/start`), plus the time it starts at, plus the commissioner's own
 * control over that time (`PUT /api/leagues/[leagueId]/draft-schedule`).
 *
 * Fix round 1 (review MEDIUM): `initialSchedule` arrives as a PROP, from `LeagueHomeBody`
 * (`leagueHome`, `@/league-service/read.ts`, which already selects the draft row and the
 * league's `isPublicMatchmade` for its own use), the same props-in idiom this room's other
 * `LeagueHome` siblings already use (`AdvisorPanel`, `LineupEditor`, `TradeInboxLink`) — no
 * `useEffect` GET on mount, no loading skeleton on every page view for data the server already
 * had. `fetchJson` is reached only for the two things that actually write: rescheduling (PUT)
 * and starting (POST) — local state is seeded from the prop and updated directly from either
 * write's own response, never re-fetched.
 *
 * Four states, every one designed (Task 6, Step 3): scheduled, scheduled-and-starting-within-
 * the-hour, in progress (a link into the room), and complete. A member who is not the
 * commissioner sees the time and the countdown and no controls — `isCommissioner` is the one
 * flag that decides whether the edit control and the start button render at all, never whether
 * the schedule itself is visible.
 */
export function DraftSchedulePanel({
  leagueId,
  isCommissioner,
  initialSchedule,
  teamCount,
  leagueName = "",
  myTeamId = null,
  currentWeek = 1,
  totalWeeks = 1,
}: {
  readonly leagueId: string;
  readonly isCommissioner: boolean;
  readonly initialSchedule: DraftScheduleBody;
  /**
   * Task 7's own short-room warning needs the league's own seat ceiling, and — the same reasoning
   * `WaitingRoomLeague`'s own docblock already states for the identical field — `DraftScheduleBody`
   * itself deliberately does not carry it (a third copy of a league's own seat count on the wire).
   * `LeagueHome` (`./league-home.tsx`) already holds `home.teamCount` for its own header line, so
   * this rides in as a second prop rather than widening the wire body.
   */
  readonly teamCount: number;
  /** Phase 3.6, Task 8: `ReleaseSeatControl`'s own Modal names the league by name. Optional
   *  (default `""`, never rendered on its own) — the same "absent means never in play" shape
   *  `WaitingRoom`'s identical prop keeps. */
  readonly leagueName?: string;
  /** `null` for a caller with no team here — the same shape `WaitingRoom`'s identical prop
   *  keeps, and the default for every caller that predates this task. */
  readonly myTeamId?: string | null;
  /**
   * Gauntlet fix wave, NEW-8: `draftTerminalStatePanel`'s own expiry window needs the season's
   * CURRENT week, not just the schedule row — `LeagueHome` already holds `home.currentWeek` for
   * its own header line, the same "rides in as a second prop rather than widening the wire body"
   * precedent `teamCount` above sets. Defaults to `1` (inside the window, matching every caller
   * that predates this task and never had a season to be deep into).
   */
  readonly currentWeek?: number;
  /** `draftTerminalStatePanel`'s own expiry window's OTHER half — `home.totalWeeks`, the same
   *  server-derived regular-season length `currentWeek` above is compared against. Defaults to
   *  `1`, matching `currentWeek`'s own default: together they keep the window open for every
   *  caller that predates this task. */
  readonly totalWeeks?: number;
}) {
  const { fetchJson } = useLeagueRoomDeps();
  const [schedule, setSchedule] = useState<DraftScheduleBody>(initialSchedule);
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // Ticks the countdown without re-fetching: the schedule itself only changes on a save or a
  // start, both of which already update `schedule` directly. Called unconditionally, before any
  // early return — React's Rules of Hooks — with `null` once there's nothing left to count down
  // to (Phase 3.5, Task 8: refactored onto the shared `useCountdown`, `@/components/ui/countdown`,
  // rather than this panel's own `useNow` + `Date.parse` arithmetic).
  const { remainingMs } = useCountdown(schedule.status === "scheduled" ? schedule.kickoffAt : null);

  const openEditor = (): void => {
    setDraftValue(toDatetimeLocalValue(schedule.kickoffAt));
    setSaveError(null);
    setEditing(true);
  };

  const save = async (): Promise<void> => {
    const parsed = new Date(draftValue);
    if (Number.isNaN(parsed.getTime())) {
      setSaveError("That does not look like a valid time.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetchJson(`/api/leagues/${leagueId}/draft-schedule`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kickoffAt: parsed.toISOString() }),
      });
      const body = (await response.json()) as ApiEnvelope<DraftScheduleBody>;
      if (!body.ok) {
        setSaveError(body.error);
        return;
      }
      setSchedule(body.data);
      setEditing(false);
    } catch {
      setSaveError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const start = async (): Promise<void> => {
    setStarting(true);
    setStartError(null);
    try {
      const response = await fetchJson(`/api/drafts/${schedule.draftId}/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = (await response.json()) as ApiEnvelope<unknown>;
      if (!body.ok) {
        setStartError(body.error);
        return;
      }
      setSchedule({ ...schedule, status: "in_progress" });
    } catch {
      setStartError("We could not reach the server. Check your connection and try again.");
    } finally {
      setStarting(false);
    }
  };

  // Persona review, Step 4: a commissioner's sharpest question about a scheduled draft is "what
  // happens if I do nothing" — a public league has a real answer (Task 7's own auto-start), and
  // a private one does not, so the two say different, equally honest things rather than one
  // sentence trying to cover both. Scoped to the commissioner: it is guidance about what THEY
  // should do, not a fact an ordinary member needs.
  const autoStartNotice =
    schedule.status !== "scheduled" ? null : schedule.isPublicMatchmade ? (
      <p className="text-sm text-text-muted">If nobody starts it, we will start it at the scheduled time.</p>
    ) : isCommissioner ? (
      <p className="text-sm text-text-muted">{"Press Start the draft when everyone is ready."}</p>
    ) : null;

  // Task 7 (F12/F21): only a SCHEDULED draft ever rolls (Step 2's own model ruling), so this
  // never appears beside a `when_full` panel — `WaitingRoom` is that trigger's own surface.
  const rolledNotice =
    schedule.status !== "scheduled" || schedule.kickoffRolls <= 0 ? null : (
      <p className="text-sm text-text-muted">{rollNoticeSentence(schedule.kickoffRolls)}</p>
    );

  // Task 8: the escape hatch. A member-league commissioner can never release
  // (`RELEASE_REFUSALS.commissioner` — no transfer-of-commissioner path), and `isCommissioner`
  // here is never true for a house league in the first place (`DraftSchedulePanel` only ever
  // renders for a `'scheduled'`-trigger draft, and a house league's own trigger is always
  // `'when_full'` — `HOUSE_CATALOG`'s own docblock), so `!isCommissioner` alone is the right gate,
  // no second branch on authority needed. Placed right beside `rolledNotice` (F12): quiet at zero
  // rolls, and visually beside the sentence that named the first slip once one has happened.
  const releaseControl =
    schedule.status !== "scheduled" || myTeamId === null || isCommissioner ? null : (
      <ReleaseSeatControl leagueId={leagueId} leagueName={leagueName} kickoffRolls={schedule.kickoffRolls} />
    );

  // Task 7, Step 3, narrowed by fix round 1's M5 (controller ruling): a PRIVATE commissioner's
  // manual press keeps its two-team floor and this warning — the one place the founder's
  // "roll until full" ruling does not bind, because there is no other way to ever draft a
  // private league nobody else can start for them. A PUBLIC MATCHMADE MEMBER league's press is
  // instead REFUSED server-side (`store.ts`'s `startDraft`), so this tells the commissioner the
  // same honest sentence proactively rather than only after a failed press.
  const openSeats = teamCount - schedule.filledTeams;
  const shortRoomNotice =
    schedule.status !== "scheduled" || !isCommissioner || openSeats <= 0 ? null : schedule.isPublicMatchmade ? (
      <p role="status" className="text-sm text-warning">
        {PUBLIC_ROOM_SHORT_REFUSAL}
      </p>
    ) : (
      <p role="status" className="text-sm text-warning">
        {shortRoomWarning(openSeats)}
      </p>
    );

  const terminal = draftTerminalStatePanel(schedule, currentWeek, totalWeeks);
  if (terminal !== null) return terminal;

  // `remainingMs` is null pre-hydration (`useNow`'s contract): the clock-derived lines hold
  // their non-ticking fallback for that one frame — the digits their placeholder, the local
  // line its absolute half alone, and `startingSoon` its "not yet known to be soon" default
  // (so the static overnight-pause note, which needs no clock, still renders).
  const startingSoon = remainingMs !== null && remainingMs <= MS_PER_HOUR;
  // Phase 3.6, Task 9, Step 2: the `xl` `Countdown` beside the fill `SeatMeter` (F17), with the
  // local-time line under it — the hero every `describeStartTiming`-adjacent surface now shares.
  // `data-testid="waiting-room-countdown"` is hardcoded rather than threaded as a prop: this
  // panel's sole caller is `WaitingRoom`, so the id it asserts on is not a value another caller
  // could ever need to change.
  const hero = (
    <div data-testid="waiting-room-hero" className="flex flex-col items-center gap-1">
      <Countdown remainingMs={remainingMs} size="xl" data-testid="waiting-room-countdown" />
      <SeatMeter filled={schedule.filledTeams} total={teamCount} />
      <p className="text-sm text-text-muted">
        {remainingMs === null ? formatLocal(schedule.kickoffAt) : `${formatLocal(schedule.kickoffAt)} (${formatRelativeCountdown(remainingMs)})`}
      </p>
      {/* Gauntlet fix wave, item 11 (JF-H4): C3's safety-net sentence, quoted verbatim, reaching
          a SCHEDULED league's waiting room — this product's most common waiting state, and the
          one the gauntlet's first-timer persona actually asked "what if I miss it" from. Only
          `full && startTrigger === "when_full"` said this before; a scheduled room never did. */}
      <p className="text-sm text-text-muted">The room picks for you from your queue if your clock runs out.</p>
    </div>
  );

  // Task 4's overnight freeze. `startingSoon` already draws the line this panel needs: a draft
  // more than an hour out picks at a tier of an hour or longer once it opens (the same
  // `DRAFT_PAUSE_WINDOW.appliesAtOrAbovePickSeconds` floor the engine itself enforces), and a
  // draft that slow can run straight through 2-5 AM Eastern. The literal times below are
  // deliberately not imported from `@/draft-engine` — client room code goes through the
  // HTTP/SSE boundary only (`eslint.config.mjs`'s `SERVER_ONLY_MODULE_GROUPS`), the same
  // constraint `RoomRail`'s own `formatTightening`/`formatYourTurn` note.
  const overnightPauseNotice = schedule.status !== "scheduled" || startingSoon ? null : (
    <p className="text-sm text-text-muted">
      Picks pause 2:00 AM to 5:00 AM Eastern on clocks of an hour or longer.
    </p>
  );

  const commissionerControls = isCommissioner ? (
    editing ? (
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Input
          label="Draft time"
          type="datetime-local"
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" loading={saving} disabled={saving}>
            Save time
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(false)} disabled={saving}>
            Cancel
          </Button>
        </div>
        {saveError === null ? null : (
          <p role="alert" className="text-sm text-negative">
            {saveError}
          </p>
        )}
      </form>
    ) : (
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={openEditor}>
          Edit time
        </Button>
        <Button size="sm" onClick={() => void start()} loading={starting} disabled={starting}>
          Start the draft
        </Button>
      </div>
    )
  ) : null;

  return (
    <div className="flex flex-col gap-2">
      <StatePanel
        tone="neutral"
        icon={startingSoon ? "bolt" : "clock"}
        title={startingSoon ? "Draft starting soon" : "Draft scheduled"}
        action={
          <div className="flex flex-col items-center gap-3">
            {hero}
            {commissionerControls}
          </div>
        }
      />
      {autoStartNotice}
      {rolledNotice}
      {releaseControl}
      {shortRoomNotice}
      {overnightPauseNotice}
      {startError === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {startError}
        </p>
      )}
    </div>
  );
}
