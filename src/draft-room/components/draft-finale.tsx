"use client";

import { useMemo } from "react";
import type { Player } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import { Button, ButtonLink, Celebration, Modal, PlayerFace, PositionBadge, SlotChip } from "@/components/ui";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { rosterFillRows } from "../state/roster-fill";
import type { FinaleStage } from "../hooks/use-draft-finale";

export interface DraftFinaleOverlayProps {
  readonly stage: FinaleStage;
  readonly view: DraftStateView;
  readonly playersById: ReadonlyMap<string, Player>;
  readonly myTeamId: string | null;
  /** The real-draft panel's quiet dismiss — back to the completed, browsable board. */
  readonly onDismiss: () => void;
  /** The mock fallback's manual refetch — one more bounded cycle, `useDraftFinale.seeDebrief`. */
  readonly onSeeDebrief: () => void;
}

/** The founder's sentence, said once, on the banner — the celebration says its own thing. */
const BANNER_SENTENCE = "The draft is in the books.";

/**
 * The compact your-roster summary inside the completion panel: `rosterFillRows` (the one
 * shared slot derivation — no second slot-assignment opinion), FILLED rows only, in the
 * drawer roster tab's own row grammar minus the peek button (the panel is a landing, not a
 * workspace). A manager with an empty roster, or a commissioner with no team at all, gets no
 * block rather than an empty frame.
 */
function PanelRoster({ view, playersById, myTeamId }: Pick<DraftFinaleOverlayProps, "view" | "playersById" | "myTeamId">) {
  const filled = useMemo(
    () =>
      rosterFillRows(view.slotConfig, myTeamId === null ? [] : (view.rosters[myTeamId] ?? [])).filter(
        (row) => row.playerId !== null,
      ),
    [view.slotConfig, view.rosters, myTeamId],
  );
  if (filled.length === 0) return null;

  return (
    <ul aria-label="Your roster, by slot" className="flex max-h-72 flex-col gap-1 overflow-y-auto">
      {filled.map((row) => {
        const player = row.playerId === null ? null : (playersById.get(row.playerId) ?? null);
        if (player === null) return null;
        return (
          <li
            key={`${row.slot}:${row.slotIndex}`}
            data-testid="finale-roster-row"
            className="flex items-center gap-2 rounded-sm bg-surface-raised px-2.5 py-1.5"
          >
            <span className="w-14 shrink-0">
              <SlotChip slot={row.slot} />
            </span>
            <PlayerFace player={player} size="sm" />
            <span className="min-w-0 truncate font-display text-md font-semibold text-text-primary">{player.name}</span>
            <PositionBadge position={player.position} size="sm" />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * THE FINALE'S CHROME (2026-09-04 — `docs/superpowers/specs/2026-09-04-draft-finale-design.md`),
 * one component per stage, rendered as an overlay inside the room viewport so BOTH format
 * rooms (and the phone inversion) inherit it without structural change:
 *
 * - `moment`: the completion beat — the banner in the clock strip's place plus the shared
 *   `Celebration`, the board visible under both. The banner reuses the strip's own growth
 *   ease and drops it under reduced motion; `Celebration` branches on reduced motion itself.
 * - `preparing`: the mock race's quiet line while one more bounded refetch cycle runs.
 * - `manual`: the mock fallback — the board stays, with one manual way into the debrief.
 * - `panel`: the real league's landing — the sentence, the roster you built, ONE ink verb to
 *   the league room (whose arrival card is already waiting), and a quiet dismiss.
 *
 * `idle`, `refetching` and `dismissed` render nothing: the board is the room.
 */
export function DraftFinaleOverlay({ stage, view, playersById, myTeamId, onDismiss, onSeeDebrief }: DraftFinaleOverlayProps) {
  const reducedMotion = usePrefersReducedMotion();

  if (stage === "moment") {
    return (
      <div className="absolute inset-x-0 top-0 z-50 flex flex-col items-center gap-4">
        <div
          data-testid="finale-banner"
          role="status"
          className={`w-full border-b border-line bg-surface-elevated px-4 py-2.5 text-center font-display text-md font-semibold text-text-primary ${reducedMotion ? "" : "animate-strip-grow"}`}
        >
          {BANNER_SENTENCE}
        </div>
        <div className="w-full max-w-md px-4">
          <Celebration
            testId="finale-celebration"
            emphasis={myTeamId === null ? "peer" : "self"}
            title="Every pick is in."
          />
        </div>
      </div>
    );
  }

  if (stage === "preparing") {
    return (
      <div className="absolute inset-x-0 top-0 z-50 flex justify-center p-3">
        <p data-testid="finale-preparing" role="status" className="rounded-md bg-surface-elevated shadow-card px-3 py-1.5 text-sm text-text-muted">
          Preparing your debrief
        </p>
      </div>
    );
  }

  if (stage === "manual") {
    return (
      <div className="absolute inset-x-0 top-0 z-50 flex justify-center p-3">
        <div className="flex items-center gap-3 rounded-md bg-surface-elevated shadow-card px-3 py-2">
          <span className="text-sm text-text-muted">Your debrief is ready when the room is.</span>
          <Button size="sm" variant="secondary" onClick={onSeeDebrief}>
            See your debrief
          </Button>
        </div>
      </div>
    );
  }

  if (stage === "panel") {
    return (
      // The shared `Modal` primitive, never a hand-rolled scrim (fix round 1, HIGH 2): it
      // brings the dialog role, the focus trap, Escape and focus restoration — and Escape
      // dismisses exactly the way "Stay on the board" does, back to the browsable board.
      <div data-testid="finale-panel">
        <Modal
          open
          title={BANNER_SENTENCE}
          onClose={onDismiss}
          footer={
            <>
              <ButtonLink href={`/app/leagues/${view.leagueId}`}>Open your league room</ButtonLink>
              <Button variant="ghost" onClick={onDismiss}>
                Stay on the board
              </Button>
            </>
          }
        >
          <PanelRoster view={view} playersById={playersById} myTeamId={myTeamId} />
        </Modal>
      </div>
    );
  }

  return null;
}
