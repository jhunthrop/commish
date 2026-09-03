"use client";

import type { Player } from "@/domain/player";
import { BottomSheet, Button, PositionBadge } from "@/components/ui";
import { QUILT_CONFIG } from "../state/config";

export interface MobileConfirmSheetProps {
  readonly player: Player;
  readonly byeWeek: number | null;
  /** The manager's own sheet rank, for the fit line. */
  readonly sheetRank: number | null;
  readonly submitting: boolean;
  /** CONFIRM PICK — hands the pick to the undo window, exactly like a desktop DRAFT press. */
  readonly onConfirm: (playerId: string) => void;
  readonly onClose: () => void;
}

/**
 * THE MOBILE CONFIRM SHEET (`MobileYourTurn` mock): picking on a phone is two-step by law —
 * mis-tap protection on a money league. BACK costs nothing; CONFIRM starts the same undo
 * window a desktop pick gets, so a phone pick is guarded twice.
 */
export function MobileConfirmSheet({ player, byeWeek, sheetRank, submitting, onConfirm, onClose }: MobileConfirmSheetProps) {
  return (
    <BottomSheet label={`Confirm your pick: ${player.name}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <PositionBadge position={player.position} />
          <div className="min-w-0">
            <p className="truncate font-display text-xl font-semibold text-text-primary">{player.name}</p>
            <p className="text-xs text-text-faint">
              {player.nflTeam}
              {byeWeek === null ? "" : ` · Bye ${byeWeek}`}
              {player.adp === null ? "" : ` · ADP ${player.adp.toFixed(1)}`}
            </p>
          </div>
        </div>
        {sheetRank === null ? null : (
          <p className="rounded-sm bg-surface-elevated px-3 py-2 text-xs text-text-muted">Your sheet ranks him {sheetRank}.</p>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Back
          </Button>
          <Button
            variant="verb"
            size="lg"
            className="flex-[2]"
            disabled={submitting}
            onClick={() => onConfirm(player.id)}
          >
            Confirm pick
          </Button>
        </div>
        <p className="text-center text-xs text-text-faint">After confirming you get a {Math.round(QUILT_CONFIG.undoWindowMs / 1_000)} second undo.</p>
      </div>
    </BottomSheet>
  );
}
