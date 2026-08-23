"use client";

import { useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { DraftScheduleBody } from "../contract";
import { Button, Input } from "@/components/ui";
import { StatePanel } from "@/components/ui/state-panel";
import { formatCoarseDuration, useCountdown } from "@/components/ui/countdown";
import { useLeagueRoomDeps } from "../hooks/deps";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/**
 * "Saturday, September 12, 7:00 PM" — the reader's OWN clock, not the fixed UTC zone
 * `LeagueTerms.draftAt` renders. This panel is already `"use client"` and already reads the
 * wall clock through `useNow` for its own countdown, so showing the commissioner's own local
 * reading of the same instant is free and more useful to someone about to schedule a keyboard
 * time around it. `new Date(iso)` parses a real, GIVEN instant — never the ambient clock — the
 * same precedent `InvitePanel`'s own `new Date(invite.expiresAt).toLocaleDateString()` sets.
 */
function formatLocal(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
 */
export function draftTerminalStatePanel(schedule: Pick<DraftScheduleBody, "status" | "draftId">): ReactNode | null {
  if (schedule.status === "complete") {
    return (
      <StatePanel
        tone="neutral"
        icon="check"
        title="Draft complete"
        description="Every roster is set."
        action={
          <Link className="text-sm font-medium text-accent underline" href={`/app/drafts/${schedule.draftId}`}>
            View the draft board
          </Link>
        }
      />
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
}: {
  readonly leagueId: string;
  readonly isCommissioner: boolean;
  readonly initialSchedule: DraftScheduleBody;
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
      setSaveError("That doesn't look like a valid time.");
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
      setSaveError("We couldn't reach the server. Check your connection and try again.");
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
      setStartError("We couldn't reach the server. Check your connection and try again.");
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
      <p className="text-sm text-text-muted">{"Nothing starts this automatically. Press Start the draft when everyone's ready."}</p>
    ) : null;

  const terminal = draftTerminalStatePanel(schedule);
  if (terminal !== null) return terminal;

  const msUntil = remainingMs ?? 0;
  const startingSoon = msUntil <= MS_PER_HOUR;
  const countdown = `${formatLocal(schedule.kickoffAt)} (${formatRelativeCountdown(msUntil)})`;

  // Task 4's overnight freeze. `startingSoon` already draws the line this panel needs: a draft
  // more than an hour out picks at a tier of an hour or longer once it opens (the same
  // `DRAFT_PAUSE_WINDOW.appliesAtOrAbovePickSeconds` floor the engine itself enforces), and a
  // draft that slow can run straight through 2-5 AM Eastern. The literal times below are
  // deliberately not imported from `@/draft-engine` — client room code goes through the
  // HTTP/SSE boundary only (`eslint.config.mjs`'s `SERVER_ONLY_MODULE_GROUPS`), the same
  // constraint `RoomRail`'s own `formatTightening`/`formatYourTurn` note.
  const overnightPauseNotice = schedule.status !== "scheduled" || startingSoon ? null : (
    <p className="text-sm text-text-muted">
      Picks pause automatically between 2:00 AM and 5:00 AM Eastern once the clock reaches an hour or longer, and resume right after.
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
        description={countdown}
        action={commissionerControls}
      />
      {autoStartNotice}
      {overnightPauseNotice}
      {startError === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {startError}
        </p>
      )}
    </div>
  );
}
