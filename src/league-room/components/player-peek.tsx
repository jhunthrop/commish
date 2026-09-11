"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Card, Modal, Skeleton } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { DossierComposition } from "../dossier/dossier-composition";
import { PlayerHeader } from "../dossier/player-header";
import { openPlayerPeek as openPlayerPeekImpl, usePeekLoad } from "./use-peek-load";
import { SeasonSwitcher } from "./season-switcher";

/** Re-exported unchanged (fix round 2 moved the module-scope `host` listener itself into
 *  `use-peek-load.ts`, alongside the hook that is its one real reader) — every existing caller
 *  keeps importing this from `player-peek.tsx`. */
export const openPlayerPeek = openPlayerPeekImpl;

/**
 * A PLAYER'S NAME, PRESSABLE (founder, 2026-08-30: "we should be able to click the players name
 * wherever they're displayed... it should bring up a pop up from the bottom"). The name is the
 * control everywhere it appears; pressing it raises the peek instead of navigating away. The full
 * page still exists — the sheet links to it — so a deep look is one more press, never lost.
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

/**
 * The one mounted receiver for `PlayerName` presses: fetches the player's season under this
 * league's rules (the same body the full page reads, via `usePeekLoad`) and raises the peek.
 * Loading shows the name immediately — the reader pressed a name, the peek answers with it before
 * the wire does.
 *
 * IT RIDES `Modal`, NOT `BottomSheet` (Sideline research round). The sheet component pins itself to
 * the foot of the viewport at every width, which on a 1440 desktop is a strip of research modules
 * along the bottom edge of the screen. `Modal`'s `center` placement IS the phone's bottom sheet
 * below `sm` (pinned to the foot, top corners rounded, capped at 85vh and scrolling inside itself)
 * and a centred card above it, so one component gives both and the two cannot drift apart. The
 * focus trap, the Escape handling and the return of focus to the pressed name come with it, which
 * `BottomSheet` never had.
 *
 * THE HEADER IS THE PAGE'S OWN (`PlayerHeader`), which is the whole point of extracting it: the
 * face, the name, who has him and the one number are the same four things in the sheet and on his
 * page, and neither surface can quietly lose one.
 */
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
    <Modal open title={target.name} onClose={close} placement="center" size="xl" titleHidden footer={null}>
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
            <PlayerHeader
              body={body}
              leagueId={target.leagueId}
              depth="peek"
              trailing={
                <Link className={`${MICRO_LABEL} text-accent underline`} href={`/app/leagues/${target.leagueId}/players/${target.playerId}`} onClick={close}>
                  Full page
                </Link>
              }
            />

            {/* THE SHARED DOSSIER COMPOSITION (fix round 1, IMPORTANT 4) — call card through
                `WhyGroups`, plus the season totals/log and the dossier-null fallback, identical
                to the full page's own composition apart from what `depth`/`readVariant`/`whyCap`
                state below. See `dossier-composition.tsx`'s own docblock. */}
            <DossierComposition body={body} dossier={dossier} depth="peek" switcher={switcher} played={played} readVariant="compact" whyCap={5} />
          </>
        )}
      </div>
    </Modal>
  );
}
