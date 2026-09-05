"use client";

import { useState, type DragEvent } from "react";
import { PositionBadge } from "@/components/ui";
import type { SheetTag } from "./types";
import type { SheetEntryView } from "./view";

const TAG_OPTIONS: readonly { readonly value: "" | SheetTag; readonly label: string }[] = [
  { value: "", label: "No tag" },
  { value: "target", label: "Target" },
  { value: "avoid", label: "Avoid early" },
  { value: "never", label: "Never draft" },
];

const TAG_TONE: Readonly<Record<SheetTag, string>> = {
  target: "text-positive",
  avoid: "text-warning",
  never: "text-negative",
};

export interface SheetTableProps {
  readonly entries: readonly SheetEntryView[];
  readonly onReorder: (order: readonly string[]) => void;
  readonly onRemove: (playerId: string) => void;
  readonly onNote: (playerId: string, note: string) => void;
  readonly onTag: (playerId: string, tag: SheetTag | null) => void;
  readonly onTierLabel: (playerId: string, tierLabel: string | null) => void;
}

/**
 * MY SHEET'S TABLE (spec §4) — tier-banded, drag AND keyboard reorderable, notes, tags, per-row
 * remove, and the quiet "you N / board M" line where the manager's own order disagrees with the
 * evidence board.
 *
 * REORDER HAS TWO INDEPENDENT PATHS, both real. Native HTML5 drag-and-drop (`draggable`,
 * `onDragStart`/`onDragOver`/`onDrop`) covers the mouse/touch case with no added dependency —
 * this codebase's own `RESEARCH & REUSE` step turned up nothing in the existing tree to reuse
 * (no drag primitive exists anywhere in `src/components/ui` or `src/draft-room`) and a full DnD
 * library is real weight for "move a row" — so the SECOND path, plain up/down icon buttons on
 * every row, is not a fallback but the primary keyboard/screen-reader story: it needs no pointer,
 * no drag gesture, and is exactly as fast for "move three spots" as a drag would be.
 */
export function SheetTable({ entries, onReorder, onRemove, onNote, onTag, onTierLabel }: SheetTableProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [editingTier, setEditingTier] = useState<string | null>(null);

  function move(playerId: string, delta: number): void {
    const order = entries.map((entry) => entry.playerId);
    const from = order.indexOf(playerId);
    const to = Math.max(0, Math.min(order.length - 1, from + delta));
    if (from === -1 || to === from) return;
    order.splice(from, 1);
    order.splice(to, 0, playerId);
    onReorder(order);
  }

  function onDrop(targetId: string): void {
    if (dragId === null || dragId === targetId) return;
    const order = entries.map((entry) => entry.playerId);
    const from = order.indexOf(dragId);
    const to = order.indexOf(targetId);
    if (from === -1 || to === -1) return;
    order.splice(from, 1);
    order.splice(to, 0, dragId);
    onReorder(order);
    setDragId(null);
  }

  if (entries.length === 0) {
    return <p className="text-sm text-text-muted">Nothing on this sheet yet. Add players from the board below, or seed it in one press.</p>;
  }

  let lastTierLabel: string | null | undefined = undefined;

  return (
    <ol className="flex flex-col gap-0.5">
      {entries.map((entry, index) => {
        const showTierHeader = entry.tierLabel !== null && entry.tierLabel !== lastTierLabel;
        lastTierLabel = entry.tierLabel ?? lastTierLabel;
        const disagrees = entry.boardRank !== null && entry.boardRank !== entry.rank;

        return (
          <li key={entry.playerId}>
            {showTierHeader ? (
              <div className="mt-3 mb-1 flex items-center gap-2 border-b border-line pb-1">
                <span className="font-display text-sm font-semibold text-accent">{entry.tierLabel}</span>
                <button type="button" className="text-xs text-text-faint hover:text-text-primary" onClick={() => onTierLabel(entry.playerId, null)}>
                  Remove tier break
                </button>
              </div>
            ) : null}
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- native HTML5
                drag-and-drop (`draggable` + the three `onDrag*` handlers) has no ARIA role of its
                own to add; the up/down buttons below are the real keyboard/screen-reader path, as
                this component's own docblock states, so this handler set is a mouse/touch
                convenience layered on top rather than the only way to reorder a row. */}
            <div
              draggable
              onDragStart={() => setDragId(entry.playerId)}
              onDragOver={(event: DragEvent<HTMLDivElement>) => event.preventDefault()}
              onDrop={() => onDrop(entry.playerId)}
              className="flex flex-col gap-1 rounded-md bg-surface-elevated px-2 py-1.5 print:bg-transparent print:px-0"
              data-testid="sheet-row"
            >
              <div className="flex items-center gap-2">
                <div className="flex flex-col print:hidden">
                  <button type="button" aria-label={`Move ${entry.name} up`} disabled={index === 0} onClick={() => move(entry.playerId, -1)} className="text-text-faint hover:text-text-primary disabled:opacity-30">
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${entry.name} down`}
                    disabled={index === entries.length - 1}
                    onClick={() => move(entry.playerId, 1)}
                    className="text-text-faint hover:text-text-primary disabled:opacity-30"
                  >
                    ▼
                  </button>
                </div>
                <span className="w-6 tabular-nums text-text-faint">{entry.rank}</span>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate font-medium text-text-primary">{entry.name}</span>
                  <PositionBadge position={entry.position} size="sm" />
                  <span className="text-xs text-text-faint">
                    {entry.team}
                    {entry.byeWeek === null ? "" : ` · bye ${entry.byeWeek}`}
                  </span>
                  {disagrees ? (
                    <span className="text-xs text-text-faint">
                      you {entry.rank} · board {entry.boardRank}
                    </span>
                  ) : null}
                </div>
                <select
                  aria-label={`Tag for ${entry.name}`}
                  value={entry.tag ?? ""}
                  onChange={(event) => onTag(entry.playerId, event.target.value === "" ? null : (event.target.value as SheetTag))}
                  className={`rounded-md border border-edge bg-surface-elevated px-1.5 py-1 text-xs print:hidden ${entry.tag === null ? "text-text-muted" : TAG_TONE[entry.tag]}`}
                >
                  {TAG_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button type="button" className="text-xs text-text-faint hover:text-text-primary print:hidden" onClick={() => setEditingTier(editingTier === entry.playerId ? null : entry.playerId)}>
                  Tier
                </button>
                <button type="button" className="text-xs text-text-faint hover:text-text-primary print:hidden" onClick={() => setEditingNote(editingNote === entry.playerId ? null : entry.playerId)}>
                  Note
                </button>
                <button type="button" aria-label={`Remove ${entry.name} from sheet`} className="text-xs text-negative hover:underline print:hidden" onClick={() => onRemove(entry.playerId)}>
                  Remove
                </button>
              </div>
              {editingTier === entry.playerId ? (
                <input
                  aria-label={`Tier label for ${entry.name}`}
                  defaultValue={entry.tierLabel ?? ""}
                  placeholder="Tier name (blank to remove)"
                  onBlur={(event) => {
                    onTierLabel(entry.playerId, event.target.value.trim() === "" ? null : event.target.value.trim());
                    setEditingTier(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  className="rounded-md border border-edge bg-surface-elevated px-2 py-1 text-sm"
                />
              ) : null}
              {editingNote === entry.playerId || (entry.note !== null && entry.note !== "") ? (
                <textarea
                  aria-label={`Note for ${entry.name}`}
                  defaultValue={entry.note ?? ""}
                  placeholder="Your own note"
                  rows={1}
                  onBlur={(event) => {
                    onNote(entry.playerId, event.target.value);
                    setEditingNote(null);
                  }}
                  className="rounded-md border border-edge bg-surface-elevated px-2 py-1 text-sm text-text-muted print:border-none print:bg-transparent print:p-0"
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
