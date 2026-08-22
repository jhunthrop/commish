"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { DraftScheduleBody } from "../contract";
import { Button, ErrorState, Input, Skeleton } from "@/components/ui";
import { StatePanel } from "@/components/ui/state-panel";
import { useLeagueRoomDeps } from "../hooks/deps";
import { useNow } from "../hooks/use-now";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

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

/** "in 3 days" / "in 5 hours" / "in 20 minutes" / "starting any moment" — never negative: once a
 *  kickoff is in the past the draft has either started (a different `status`) or Task 7's own
 *  auto-start is about to catch it, so there is no "3 hours ago" this panel needs to word. */
function formatCountdown(msUntil: number): string {
  if (msUntil <= 0) return "starting any moment";
  if (msUntil < MS_PER_HOUR) {
    const minutes = Math.max(1, Math.round(msUntil / MS_PER_MINUTE));
    return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  if (msUntil < MS_PER_DAY) {
    const hours = Math.round(msUntil / MS_PER_HOUR);
    return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.round(msUntil / MS_PER_DAY);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

/** `<input type="datetime-local">`'s own value format — no timezone, read and written in
 *  whatever zone the browser is already in, which is exactly the zone `formatLocal` above
 *  displays in. */
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type PanelState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly reason: string }
  | { readonly status: "ready"; readonly schedule: DraftScheduleBody };

/**
 * The button that has existed since Phase 1 and nobody could ever press on purpose
 * (`POST /api/drafts/[draftId]/start`), plus the time it starts at, plus the commissioner's own
 * control over that time (`PUT /api/leagues/[leagueId]/draft-schedule`). Fetches its own data —
 * the same self-contained shape `JoinForm` uses for the invite preview — rather than riding
 * `LeagueHomeBody`, so this panel's own edits and starts can update its state directly without
 * asking `LeagueHome`'s server-rendered parent to re-fetch the whole page.
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
}: {
  readonly leagueId: string;
  readonly isCommissioner: boolean;
}) {
  const { fetchJson } = useLeagueRoomDeps();
  const [state, setState] = useState<PanelState>({ status: "loading" });
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  // Ticks the countdown without re-fetching: the schedule itself only changes on a save or a
  // start, both of which already update `state` directly.
  const now = useNow(30_000);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    (async (): Promise<void> => {
      try {
        const response = await fetchJson(`/api/leagues/${leagueId}/draft-schedule`);
        const body = (await response.json()) as ApiEnvelope<DraftScheduleBody>;
        if (cancelled) return;
        setState(body.ok ? { status: "ready", schedule: body.data } : { status: "error", reason: body.error });
      } catch {
        if (!cancelled) {
          setState({ status: "error", reason: "We couldn't reach the server. Check your connection and try again." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leagueId, fetchJson, retryToken]);

  if (state.status === "loading") return <Skeleton lines={3} />;
  if (state.status === "error") {
    return (
      <ErrorState
        title="We couldn't load the draft schedule"
        description={state.reason}
        action={
          <Button size="sm" onClick={() => setRetryToken((token) => token + 1)}>
            Try again
          </Button>
        }
      />
    );
  }

  const { schedule } = state;

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
      setState({ status: "ready", schedule: body.data });
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
      setState({ status: "ready", schedule: { ...schedule, status: "in_progress" } });
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

  const kickoffMs = new Date(schedule.kickoffAt).getTime();
  const msUntil = kickoffMs - now;
  const startingSoon = msUntil <= MS_PER_HOUR;
  const countdown = `${formatLocal(schedule.kickoffAt)} (${formatCountdown(msUntil)})`;

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
      {startError === null ? null : (
        <p role="alert" className="text-sm text-negative">
          {startError}
        </p>
      )}
    </div>
  );
}
