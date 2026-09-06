"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { BottomSheet, PlayerObject } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { PlayerSeasonBody } from "@/league-service/player";
import { DossierComposition } from "../dossier/dossier-composition";
import { useLeagueRoomDeps } from "../hooks/deps";
import { SeasonSwitcher } from "./season-switcher";

interface PeekTarget {
  readonly leagueId: string;
  readonly playerId: string;
  readonly name: string;
}

/**
 * ONE listener, module scope: `PlayerName` triggers anywhere in the tree reach the single
 * `PlayerPeekHost` the page mounts, with no context threading through the server components
 * between them. A trigger pressed with no host mounted does nothing, quietly — the failure mode
 * is a dead click, never a crash.
 */
let host: ((target: PeekTarget) => void) | null = null;

export function openPlayerPeek(target: PeekTarget): void {
  host?.(target);
}

/**
 * A PLAYER'S NAME, PRESSABLE (founder, 2026-08-30: "we should be able to click the players name
 * wherever they're displayed... it should bring up a pop up from the bottom"). The name is the
 * control everywhere it appears; pressing it raises the bottom-sheet peek instead of navigating
 * away. The full page still exists — the sheet links to it — so a deep look is one more press,
 * never lost.
 */
export function PlayerName({
  leagueId,
  playerId,
  name,
  className = "",
  children,
}: {
  readonly leagueId: string;
  readonly playerId: string;
  readonly name: string;
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => openPlayerPeek({ leagueId, playerId, name })}
      className={`min-w-0 cursor-pointer text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
    >
      {children ?? name}
    </button>
  );
}

/** The header's own identity line — bye week moved up beside the roster fact (dossier plan, Task
 *  5: "WR · NYG · Bye week 8 · Free agent…" in the approved mock). `PlayerObject` already draws
 *  the position and team as chips right above this line, so this states only the two facts it
 *  does not: his bye (from `body.dossier`, `null` when there is no dossier to read it off) and the
 *  roster fact (Task 4, context honesty: silent in a mock league, which has no real room to be a
 *  free agent "in"). Either half missing simply drops out of the joined sentence rather than
 *  leaving a dangling separator. */
function identityLine(body: PlayerSeasonBody): string {
  const byeWeek = body.dossier?.byeWeek ?? null;
  const rosterFact = body.isMockLeague ? null : body.ownedBy === null ? "Free agent in this league" : `On ${body.ownedBy}`;
  return [byeWeek === null ? null : `Bye week ${byeWeek}`, rosterFact].filter((clause): clause is string => clause !== null).join(" · ");
}

/**
 * The one mounted receiver for `PlayerName` presses: fetches the player's season under this
 * league's rules (the same body the full page reads) and raises the sheet. Loading shows the
 * name immediately — the reader pressed a name, the sheet answers with it before the wire does.
 */
export function PlayerPeekHost() {
  const { fetchJson } = useLeagueRoomDeps();
  const [target, setTarget] = useState<PeekTarget | null>(null);
  const [body, setBody] = useState<PlayerSeasonBody | null>(null);
  const [failed, setFailed] = useState(false);
  // `null` means "let the service pick" — its own default, the newest season with data for him.
  // Set only once a manager presses a segment in the switcher below (2026-09-04 widening).
  const [season, setSeason] = useState<number | null>(null);

  useEffect(() => {
    // Opening a new target resets any season a prior peek's manager had picked — his choice on
    // one player's card has no business surviving onto the next name pressed.
    const openTarget = (next: PeekTarget) => {
      setSeason(null);
      setTarget(next);
    };
    host = openTarget;
    return () => {
      if (host === openTarget) host = null;
    };
  }, []);

  useEffect(() => {
    if (target === null) return;
    setBody(null);
    setFailed(false);
    let alive = true;
    void (async () => {
      try {
        const seasonParam = season === null ? "" : `&season=${season}`;
        const response = await fetchJson(
          `/api/leagues/${target.leagueId}/player-season?playerId=${encodeURIComponent(target.playerId)}${seasonParam}`,
          { method: "GET" },
        );
        const envelope = (await response.json()) as ApiEnvelope<PlayerSeasonBody>;
        if (!alive) return;
        if (envelope.ok) setBody(envelope.data);
        else setFailed(true);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [target, season, fetchJson]);

  if (target === null) return null;
  const played = body?.weeks.some((week) => week.points !== null) ?? false;
  // Player Dossier plan, Task 5 — `undefined` (a fixture predating the dossier) and `null` (the
  // board never ranked him, `collectPlayerFacts`'s own honest answer) are the SAME "nothing to
  // build the dossier composition from" state; the double-check idiom folds both into one.
  const dossier = body?.dossier ?? null;
  const switcher = body !== null && body.availableSeasons.length > 1 ? <SeasonSwitcher seasons={body.availableSeasons} season={season ?? body.season} onSelect={setSeason} /> : undefined;

  return (
    <BottomSheet label={target.name} onClose={() => setTarget(null)}>
      <div className="flex flex-col gap-6">
        {body === null ? (
          <div className="flex flex-col gap-2">
            <p className="font-display text-2xl font-bold text-text-primary">{target.name}</p>
            <p className="text-sm text-text-muted">{failed ? "We could not load him. Close this and try again." : "Loading…"}</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-3">
                  <PlayerObject player={body.player} />
                  {/* The designation, said in the verdict channel: "Q"/"O"/"IR" beside the name
                      is the one fact a manager checks before anything else. Absent = the feed
                      does not name him, and nothing prints. Unchanged by the dossier composition
                      below — `StoryModule`'s own pill covers the story card, this one covers the
                      header, and both may say the same thing at once on purpose. */}
                  {body.injuryDesignation === null ? null : (
                    <span className="rounded-sm bg-negative px-1.5 py-0.5 font-mono text-sm font-semibold text-negative-text">{body.injuryDesignation}</span>
                  )}
                </div>
                {identityLine(body) === "" ? null : <p className="text-sm text-text-muted">{identityLine(body)}</p>}
              </div>
              <Link
                className={`${MICRO_LABEL} pt-2 text-accent underline`}
                href={`/app/leagues/${target.leagueId}/players/${target.playerId}`}
                onClick={() => setTarget(null)}
              >
                Full page
              </Link>
            </div>

            {/* THE SHARED DOSSIER COMPOSITION (fix round 1, IMPORTANT 4) — call card through
                `WhyGroups`, plus the season totals/log and the dossier-null fallback, identical
                to the full page's own composition apart from what `depth`/`readVariant`/`whyCap`
                state below. See `dossier-composition.tsx`'s own docblock. */}
            <DossierComposition body={body} dossier={dossier} depth="peek" switcher={switcher} played={played} readVariant="compact" whyCap={5} />
          </>
        )}
      </div>
    </BottomSheet>
  );
}
