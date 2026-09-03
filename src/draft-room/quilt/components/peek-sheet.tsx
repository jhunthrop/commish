"use client";

import { useMemo, useState } from "react";
import type { Player } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import type { BoardReason } from "@/projections/preseason/board";
import { Button, PositionBadge } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { formatAdp } from "../../lib/tiers";

export interface PeekFacts {
  readonly player: Player;
  /** 1-based rank on our board, or null when the board does not rank him. */
  readonly boardRank: number | null;
  /** 1-based rank on the manager's own sheet, or null before the sheet has him. */
  readonly sheetRank: number | null;
  readonly byeWeek: number | null;
  readonly reasons: readonly BoardReason[];
  /** The manager's own sheet note, or null. */
  readonly note: string | null;
  /** True when the player is already drafted — the peek then reads as a record, not a prospect. */
  readonly drafted: boolean;
  readonly queued: boolean;
}

export interface PeekSheetProps {
  readonly facts: PeekFacts;
  readonly view: DraftStateView;
  readonly myTeamId: string | null;
  /** True while the caller may act right now (their turn, or an owed pick). */
  readonly canDraft: boolean;
  readonly submitting: boolean;
  readonly onDraft: (playerId: string) => void;
  readonly onQueueToggle: (playerId: string) => void;
  readonly onNote: (playerId: string, note: string) => void;
  readonly onClose: () => void;
}

/** The GENERIC edge line (founder secrecy ruling): count and net effect, never a law's name. */
export function edgeSummary(reasons: readonly BoardReason[]): string | null {
  const laws = reasons.filter((reason): reason is Extract<BoardReason, { code: "law" }> => reason.code === "law");
  if (laws.length === 0) return null;
  const net = laws.reduce((sum, reason) => sum + reason.effect, 0);
  const signed = `${net >= 0 ? "+" : ""}${net.toFixed(1)}`;
  return `${laws.length} ${laws.length === 1 ? "edge applies" : "edges apply"} · net ${signed} pts per game`;
}

/** The availability outlook, when the board measured one. */
function availabilityOf(reasons: readonly BoardReason[]): Extract<BoardReason, { code: "availability" }> | null {
  return reasons.find((reason): reason is Extract<BoardReason, { code: "availability" }> => reason.code === "availability") ?? null;
}

/** The first open roster slot this player can fill for the caller, in the league's own order. */
function fillsSlot(view: DraftStateView, myTeamId: string | null, player: Player): string | null {
  if (myTeamId === null) return null;
  const filled = new Map<string, number>();
  for (const slot of view.rosters[myTeamId] ?? []) filled.set(slot.slot, (filled.get(slot.slot) ?? 0) + 1);
  for (const config of view.slotConfig) {
    if (!config.eligiblePositions.includes(player.position)) continue;
    if ((filled.get(config.slot) ?? 0) < config.count) return config.slot;
  }
  return null;
}

/**
 * THE PEEK SHEET — the dense player card over the right edge (`PlayerCard` mock), carrying only
 * facts this room actually holds: identity, the three ranks, the availability outlook, the
 * GENERIC edge line, roster fit, and the manager's own note. Click-away dismisses (the backdrop
 * is the click target); ✕ and Esc do the same job for keyboards.
 */
export function PeekSheet({ facts, view, myTeamId, canDraft, submitting, onDraft, onQueueToggle, onNote, onClose }: PeekSheetProps) {
  const { player } = facts;
  const [editingNote, setEditingNote] = useState(false);
  const [draftNote, setDraftNote] = useState(facts.note ?? "");

  const saveNote = (): void => {
    onNote(player.id, draftNote);
    setEditingNote(false);
  };
  const availability = useMemo(() => availabilityOf(facts.reasons), [facts.reasons]);
  const edges = useMemo(() => edgeSummary(facts.reasons), [facts.reasons]);
  const slot = useMemo(() => fillsSlot(view, myTeamId, player), [view, myTeamId, player]);
  const adp = formatAdp(player.adp);
  const marketGap = player.adp !== null && facts.boardRank !== null ? Math.round(player.adp) - facts.boardRank : null;

  return (
    <>
      {/* The click-away layer: transparent, behind the sheet, over everything else. */}
      <button type="button" aria-label="Close player card" onClick={onClose} className="fixed inset-0 z-20 cursor-default bg-transparent" />
      <aside
        data-testid="peek-sheet"
        aria-label={`${player.name}, player card`}
        className="absolute inset-y-0 right-0 z-30 flex w-[340px] max-w-full flex-col gap-3 overflow-y-auto border-l-2 border-accent bg-surface-elevated p-4 shadow-card"
      >
        <div className="flex items-center gap-3 border-b border-line pb-3">
          <PositionBadge position={player.position} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-xl font-semibold text-text-primary">{player.name}</p>
            <p className="text-xs text-text-faint">
              {player.nflTeam}
              {facts.byeWeek === null ? "" : ` · Bye ${facts.byeWeek}`}
              {facts.drafted ? " · Drafted" : ""}
            </p>
          </div>
          <Button size="sm" variant="ghost" aria-label="Close player card" onClick={onClose}>
            ✕
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Figure label="OUR BOARD" value={facts.boardRank === null ? "·" : String(facts.boardRank)} accent={false} />
          <Figure label="YOUR SHEET" value={facts.sheetRank === null ? "·" : String(facts.sheetRank)} accent />
          <Figure label="ADP" value={adp ?? "·"} accent={false} />
        </div>

        {marketGap !== null && marketGap !== 0 ? (
          <p className="rounded-sm bg-surface-raised px-3 py-2 text-xs text-text-muted">
            {marketGap > 0 ? `We rank him ${marketGap} ${marketGap === 1 ? "place" : "places"} higher than the room's consensus.` : `The room's consensus ranks him ${-marketGap} ${marketGap === -1 ? "place" : "places"} higher than we do.`}
          </p>
        ) : null}

        {availability !== null ? (
          <div className="flex flex-col gap-1">
            <p className={`${MICRO_LABEL} text-text-faint`}>Availability</p>
            <p className="rounded-sm bg-surface-raised px-3 py-2 text-xs text-text-muted">
              Expected <span className="font-semibold text-text-primary tabular-nums">{availability.expectedGames.toFixed(1)}</span> games · range{" "}
              <span className="tabular-nums">{availability.floorGames}</span> to <span className="tabular-nums">{availability.ceilingGames}</span>
            </p>
          </div>
        ) : null}

        <div className="flex flex-col gap-1">
          <p className={`${MICRO_LABEL} text-text-faint`}>Measured edges</p>
          <p data-testid="peek-edges" className="rounded-sm bg-surface-raised px-3 py-2 text-xs text-text-muted">
            {edges ?? "No measured edge on him"}
            {edges !== null ? <span className="text-text-faint"> · detail withheld in room</span> : null}
          </p>
        </div>

        {slot !== null && !facts.drafted ? (
          <div className="flex flex-col gap-1">
            <p className={`${MICRO_LABEL} text-text-faint`}>Roster fit</p>
            <p className="rounded-sm bg-surface-raised px-3 py-2 text-xs text-positive">Fills your open {slot} slot</p>
          </div>
        ) : null}

        <div className="flex flex-col gap-1">
          <p className={`${MICRO_LABEL} text-text-faint`}>Your note</p>
          {editingNote ? (
            <div className="flex flex-col gap-2">
              <textarea
                aria-label={`Your note on ${player.name}`}
                value={draftNote}
                onChange={(event) => setDraftNote(event.target.value)}
                // Esc mid-note SAVES and leaves editing — never discards the words, never
                // collapses the peek (review MEDIUM 4). Stopping propagation is what keeps the
                // room's own Esc (collapse everything, `use-room-keys`) out of this keystroke;
                // the next Esc, with the note closed, collapses as always.
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.stopPropagation();
                  saveNote();
                }}
                rows={3}
                className="rounded-sm border border-edge bg-surface-raised px-3 py-2 text-sm text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
              />
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={saveNote}>
                  Save note
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingNote(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditingNote(true)}
              className="rounded-sm border-l-2 border-accent bg-surface-raised px-3 py-2 text-left text-xs italic text-text-muted focus-visible:outline-2 focus-visible:outline-accent"
            >
              {facts.note ?? "Add a note"}
            </button>
          )}
        </div>

        {facts.drafted ? null : (
          <div className="mt-auto flex gap-2 border-t border-line pt-3">
            <Button variant="secondary" className="flex-1" disabled={submitting} onClick={() => onQueueToggle(player.id)}>
              {facts.queued ? "Unqueue" : "+ Queue"}
            </Button>
            {canDraft ? (
              <Button variant="verb" className="flex-[2]" disabled={submitting} onClick={() => onDraft(player.id)}>
                Draft now
              </Button>
            ) : null}
          </div>
        )}
      </aside>
    </>
  );
}

function Figure({ label, value, accent }: { readonly label: string; readonly value: string; readonly accent: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-sm bg-surface-raised px-3 py-2">
      <span className={`font-display text-lg font-bold tabular-nums ${accent ? "text-accent" : "text-text-primary"}`}>{value}</span>
      <span className={`${MICRO_LABEL} text-text-faint`}>{label}</span>
    </div>
  );
}
