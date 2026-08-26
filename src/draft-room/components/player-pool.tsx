"use client";

import { useMemo, useState } from "react";
import type { Player, Position } from "@/domain/player";
import type { DraftStateView } from "@/draft-engine";
import { Badge, Button, EmptyState, Input, PositionBadge } from "@/components/ui";
import { queueButtonLabel } from "../lib/lookups";
import { DRAFT_ROOM_CONFIG } from "../state/config";

const ALL = "ALL";
const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

export interface PlayerPoolProps {
  /** Server-ranked, best first. This component never re-ranks. */
  readonly players: readonly Player[];
  readonly view: DraftStateView;
  readonly pendingPlayerId: string | null;
  /** True only when the server says it is this user's turn to act. */
  readonly canAct: boolean;
  /**
   * The caller's own team, or null when watching. Task 5's own use: a team that owes a pick may
   * make it any time, whether or not `canAct` (this team's REAL current turn) is also true — the
   * Draft button lives on their turn and off it.
   */
  readonly myTeamId: string | null;
  /** "Draft" for snake, "Nominate" for auction. */
  readonly actionLabel: string;
  readonly submitting: boolean;
  readonly onAct: (playerId: string) => void;
  readonly queuedPlayerIds: ReadonlySet<string>;
  readonly onQueue: (playerId: string) => void;
}

interface PoolRow {
  readonly player: Player;
  readonly rank: number;
  readonly drafted: boolean;
}

/**
 * The position filters, as the same stickers the board is made of. Toggles rather than a
 * `<select>` because narrowing to "just the running backs" is the single most-used gesture in
 * a draft, and it should cost one tap, not two plus a scroll. `aria-pressed` is what makes
 * them real toggles to a screen reader rather than six unlabelled buttons.
 */
function PositionFilters({ value, onChange }: { readonly value: string; readonly onChange: (next: string) => void }) {
  return (
    <div role="group" aria-label="Filter by position" className="flex flex-wrap items-center gap-1">
      <Button
        size="sm"
        variant={value === ALL ? "primary" : "ghost"}
        aria-pressed={value === ALL}
        onClick={() => onChange(ALL)}
      >
        All
      </Button>
      {POSITIONS.map((position) => (
        // A bare toggle, not a padded Button: seven chips must sit on one rail row, and the
        // sticker badge already is the visual — button chrome around it was pure width.
        // Task 13's own axe pass caught the previous `opacity-80` inactive treatment for real:
        // `PositionBadge` is white text on a solid sticker fill, verified ≥4.5:1 at FULL opacity
        // only (`tokens.test.ts`) — dimming the whole button toward the room's own (light-theme)
        // near-white ground washes the fill toward that ground faster than it washes the text,
        // closing the gap for RB and TE specifically. The ring alone (already the selected
        // state's own signal) is what tells the six stickers apart from "no ring", the same
        // accent/ghost distinction the "All" button beside them already uses — no dimming
        // anywhere means no theme can ever wash a sticker's own contrast out again.
        <button
          key={position}
          type="button"
          aria-pressed={value === position}
          aria-label={`Show ${position} only`}
          className={`rounded-sm p-0.5 focus-visible:outline-2 focus-visible:outline-accent ${value === position ? "ring-2 ring-accent" : ""}`}
          onClick={() => onChange(value === position ? ALL : position)}
        >
          <PositionBadge position={position} size="sm" />
        </button>
      ))}
    </div>
  );
}

/**
 * The pool, as the room's left-hand rail: search, position stickers, and one compact row per
 * player. A list rather than a `Table` — at rail width there are no columns worth aligning,
 * and the row's meaning is "this player, and the two things I can do with him".
 *
 * The star is the queue toggle; the button beside it is the act. Both are real, named
 * controls, so the whole pool is walkable from the keyboard.
 */
export function PlayerPool({ players, view, pendingPlayerId, canAct, myTeamId, actionLabel, submitting, onAct, queuedPlayerIds, onQueue }: PlayerPoolProps) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState(ALL);
  // Task 5: a team that owes a pick may make it any time, so the row-level Draft button below
  // is live for them even when `canAct` (this team's REAL current turn) is false.
  const owesPick = myTeamId !== null && (view.owedPicks?.[myTeamId]?.length ?? 0) > 0;
  const canDraft = canAct || owesPick;
  // A live pool's one job is "who can I take" — drafted names hide unless asked for.
  const [showDrafted, setShowDrafted] = useState(false);

  const available = useMemo(() => new Set(view.availablePlayerIds), [view.availablePlayerIds]);
  // Before START_DRAFT the engine has no pool yet, so `availablePlayerIds` is empty — which is
  // "we don't know yet", NOT "everybody is drafted". Showing a board of "Drafted" badges to a
  // manager waiting on their commissioner was the single most confusing thing in the room.
  const preStart = view.phase === "scheduled";
  // The full match set, before the page-size cap below — its length is what tells the
  // truncation notice how many rows are hidden.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return players
      .map((player, index): PoolRow => ({ player, rank: index + 1, drafted: !preStart && !available.has(player.id) }))
      .filter((row) => (position === ALL || row.player.position === position) && (needle === "" || row.player.name.toLowerCase().includes(needle)))
      .filter((row) => showDrafted || !row.drafted);
  }, [players, available, preStart, query, position, showDrafted]);
  const rows = useMemo(() => filtered.slice(0, DRAFT_ROOM_CONFIG.poolPageSize), [filtered]);
  const truncated = filtered.length > DRAFT_ROOM_CONFIG.poolPageSize;

  return (
    <section aria-label="Player pool" className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex shrink-0 flex-col gap-2">
        <Input label="Search players" value={query} placeholder="Name" onChange={(event) => setQuery(event.target.value)} />
        <PositionFilters value={position} onChange={setPosition} />
        {preStart ? null : (
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <input type="checkbox" checked={showDrafted} onChange={(event) => setShowDrafted(event.target.checked)} />
            Show drafted players
          </label>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No players match"
          description="Try a different name or position."
          icon="search"
          action={
            <Button
              onClick={() => {
                setQuery("");
                setPosition(ALL);
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <ol aria-label="Available players, best first" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {rows.map((row) => {
            const queued = queuedPlayerIds.has(row.player.id);
            return (
              <li
                key={row.player.id}
                className={`flex h-11 shrink-0 items-center gap-2 rounded-sm border border-line px-2 ${row.drafted ? "opacity-60" : "bg-surface-elevated"}`}
              >
                <span className="w-5 shrink-0 text-right font-mono text-xs tabular-nums text-text-muted">{row.rank}</span>
                <PositionBadge position={row.player.position} size="sm" />
                <span className="min-w-0 flex-1 truncate font-display font-semibold text-text-primary">{row.player.name}</span>
                <span className="shrink-0 text-xs text-text-muted">{row.player.nflTeam}</span>
                {row.drafted ? null : (
                  <Button size="sm" variant="ghost" disabled={submitting} aria-label={queueButtonLabel(row.player.name, queued)} onClick={() => onQueue(row.player.id)}>
                    <span aria-hidden="true" className={queued ? "text-accent" : "text-text-muted"}>
                      {queued ? "★" : "☆"}
                    </span>
                  </Button>
                )}
                {preStart ? null : row.drafted ? ( // E11: pre-start rows have no action — sixty quiet dashes said nothing; the star is the action.
                  <Badge tone="neutral">Drafted</Badge>
                ) : canDraft ? (
                  // Picking mode: the act button exists while it is genuinely your turn, OR
                  // (Task 5) while you owe a pick from an earlier skip — live on your turn and
                  // off it. While neither is true, the star is the action — a disabled "Draft"
                  // would be a lie-in-waiting.
                  <Button
                    size="sm"
                    loading={submitting && pendingPlayerId === row.player.id}
                    onClick={() => onAct(row.player.id)}
                  >
                    {actionLabel}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {truncated ? (
        <p className="shrink-0 text-sm text-text-muted">
          Showing the top {rows.length} of {filtered.length}. Narrow your search to see more.
        </p>
      ) : null}
    </section>
  );
}
