"use client";

import { useEffect, useState } from "react";
import { CreateSheet, type CreateSheetDefaults } from "./create-sheet";

const CREATE_LEAGUE_HASH = "#create-league";

/**
 * ONE listener, module scope: the `PlayerPeekHost` idiom (`./player-peek.tsx`'s own docblock)
 * applied to the founder's 2026-09-05 ruling — "use the same bottom sheet everywhere across the
 * app when clicking create league anywhere". Every IN-APP "Create a league" affordance calls
 * `openCreateLeagueSheet()` instead of holding its own open state or linking at a scroll anchor.
 * A trigger pressed with no host mounted does nothing, quietly — the same dead-click-not-crash
 * failure mode `PlayerPeekHost` accepts, never a crash.
 *
 * NEVER A PARALLEL SYSTEM (this reuses `create-sheet.tsx`'s own law): this host renders the
 * EXISTING `CreateSheet` — the front door's crew-create sheet (name/teams/scoring/buy-in/draft
 * night, house defaults, the real `POST /api/leagues` underneath) — completely unchanged. The
 * front door's own `CrewDoor` keeps its local open/close state and keeps working exactly as
 * before; this host is the only NEW thing in-app callers reach, and it shares that one component
 * rather than growing a second create surface with its own fields.
 */
let host: (() => void) | null = null;

export function openCreateLeagueSheet(): void {
  host?.();
}

/**
 * Mounted ONCE, in the `(shell)` layout's own chrome (`AppShell`) — the same "one app-wide
 * singleton" shape `NoticesProvider` holds at the root layout, one level down: every page under
 * `/app` reaches this single instance rather than each page mounting its own.
 *
 * `signedIn` is always `true` here: the shell only ever renders behind `requireCurrentUser()`
 * (`(shell)/layout.tsx`), so there is no signed-out branch to thread through this host the way
 * the front door threads one into `CrewDoor`.
 *
 * DEEP LINKS KEEP WORKING, on mount AND after it (production incident, 2026-09-03, the same one
 * `StartOrJoinDisclosure`'s own docblock recounts): a click on an already-loaded `/app` page —
 * the league rail's own "Find or start a league" link included — only fires `hashchange`, never
 * a fresh mount, so the mount-only read that used to live on `StartOrJoinDisclosure` is joined
 * here by the same listener. The hash is cleared with `replaceState` once read (never
 * `pushState`, which would hand the visitor a spurious extra "back" step, and never a plain
 * `location.hash = ""`, which would itself fire another `hashchange`) — the create story is now
 * entirely this host's, not a scroll target `StartOrJoinDisclosure` or `FirstRunPanel` has to
 * carry state for.
 */
export function CreateLeagueSheetHost({ defaults }: { readonly defaults: CreateSheetDefaults }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openSheet = () => setOpen(true);
    host = openSheet;
    return () => {
      if (host === openSheet) host = null;
    };
  }, []);

  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash !== CREATE_LEAGUE_HASH) return;
      setOpen(true);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  if (!open) return null;
  return <CreateSheet signedIn defaults={defaults} onClose={() => setOpen(false)} />;
}
