"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BottomSheet, Card, PlayerObject, Skeleton } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import type { PlayerSeasonBody } from "@/league-service/player";
import { DossierComposition } from "../dossier/dossier-composition";
import { openPlayerPeek as openPlayerPeekImpl, usePeekLoad, type PeekTarget } from "./use-peek-load";
import { SeasonSwitcher } from "./season-switcher";

/** Re-exported unchanged (fix round 2 moved the module-scope `host` listener itself into
 *  `use-peek-load.ts`, alongside the hook that is its one real reader) — every existing caller
 *  keeps importing this from `player-peek.tsx`. */
export const openPlayerPeek = openPlayerPeekImpl;

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
 * THE SHEET'S OWN HEADER (fix round 2, extracted from `PlayerPeekHost` for the same under-fifty-
 * line rule `dossier-composition.tsx`'s own extraction served): the name/position chips, the
 * injury designation pill, the bye/roster identity line, and the link to the full page. No
 * behavior change — byte-identical markup to what `PlayerPeekHost` used to render inline.
 */
function PeekHeader({ body, target, onClose }: { readonly body: PlayerSeasonBody; readonly target: PeekTarget; readonly onClose: () => void }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-3">
          <PlayerObject player={body.player} />
          {/* The designation, said in the verdict channel: "Q"/"O"/"IR" beside the name is the
              one fact a manager checks before anything else. Absent = the feed does not name
              him, and nothing prints. Unchanged by the dossier composition below —
              `StoryModule`'s own pill covers the story card, this one covers the header, and
              both may say the same thing at once on purpose. */}
          {body.injuryDesignation === null ? null : (
            <span className="rounded-sm bg-negative px-1.5 py-0.5 font-mono text-sm font-semibold text-negative-text">{body.injuryDesignation}</span>
          )}
        </div>
        {identityLine(body) === "" ? null : <p className="text-sm text-text-muted">{identityLine(body)}</p>}
      </div>
      <Link className={`${MICRO_LABEL} pt-2 text-accent underline`} href={`/app/leagues/${target.leagueId}/players/${target.playerId}`} onClick={onClose}>
        Full page
      </Link>
    </div>
  );
}

/**
 * The one mounted receiver for `PlayerName` presses: fetches the player's season under this
 * league's rules (the same body the full page reads, via `usePeekLoad`) and raises the sheet.
 * Loading shows the name immediately — the reader pressed a name, the sheet answers with it
 * before the wire does.
 */
/**
 * THE PEEK'S OWN BODY, WHILE THE WIRE IS STILL OUT (founder, 2026-09-07, on a screenshot of the
 * sheet mid-load) — the header renders from the row the manager just pressed, and everything under
 * it used to be five to fifteen seconds of empty dark on a cold start or an off-board player.
 *
 * THE FRAME, NOT A SPINNER. Three module-shaped cards carrying the design system's own `Skeleton`,
 * so the sheet has the SHAPE of the answer while it waits and the modules land in place rather
 * than shoving a spinner out of the way. One line of copy says what is happening and stops there.
 */
function PeekBodySkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="false">
      <Card as="section" aria-label="Loading his call">
        <Skeleton lines={2} />
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card as="section" aria-label="Loading his range">
          <Skeleton lines={3} />
        </Card>
        <Card as="section" aria-label="Loading his role">
          <Skeleton lines={3} />
        </Card>
      </div>
    </div>
  );
}

export function PlayerPeekHost() {
  const { target, body, failed, season, setSeason, close } = usePeekLoad();

  if (target === null) return null;
  const played = body?.weeks.some((week) => week.points !== null) ?? false;
  // Player Dossier plan, Task 5 — `undefined` (a fixture predating the dossier) and `null` (the
  // board never ranked him, `collectPlayerFacts`'s own honest answer) are the SAME "nothing to
  // build the dossier composition from" state; the double-check idiom folds both into one.
  const dossier = body?.dossier ?? null;
  const switcher = body !== null && body.availableSeasons.length > 1 ? <SeasonSwitcher seasons={body.availableSeasons} season={season ?? body.season} onSelect={setSeason} /> : undefined;

  return (
    <BottomSheet label={target.name} onClose={close}>
      <div className="flex flex-col gap-6">
        {body === null ? (
          <div className="flex flex-col gap-4" data-peek="pending">
            <div className="flex flex-col gap-2">
              <p className="font-display text-2xl font-bold text-text-primary">{target.name}</p>
              <p className="text-sm text-text-muted">{failed ? "We could not load him. Close this and try again." : "Pulling his numbers."}</p>
            </div>
            {failed ? null : <PeekBodySkeleton />}
          </div>
        ) : (
          <>
            <PeekHeader body={body} target={target} onClose={close} />

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
