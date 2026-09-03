"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Player, Position } from "@/domain/player";
import type { BoardReason } from "@/projections/preseason/board";
import { Badge, Button, EmptyState, Movement, PositionBadge } from "@/components/ui";
import { DRAFT_ROOM_CONFIG } from "../../state/config";
import type { NeedFraction } from "../state/lens";
import { formatAdp, positionRanks } from "../../lib/tiers";
import { edgeSummary } from "./peek-sheet";
import { DrawerRow } from "./drawer-row";
import type { RoomActs } from "./room-acts";

const ALL = "ALL";
const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

export interface DrawerPoolTabProps extends RoomActs {
  /** Server-ranked, best first — never re-ranked here. */
  readonly players: readonly Player[];
  readonly available: ReadonlySet<string>;
  readonly byeWeeks: ReadonlyMap<string, number>;
  readonly reasons: ReadonlyMap<string, readonly BoardReason[]>;
  /** True when `/` opened this tab — the search field takes focus. */
  readonly focusSearch: boolean;
  /** The caller's need fractions for the filter row ("RB 1/2", "QB 1/1 ✓") — the Sleeper
   *  grammar the founder ruled in. Omitted on the phone: the 390pt filter row already spends
   *  its width on search plus six position stickers (spec, mobile judgment). */
  readonly needs?: readonly NeedFraction[];
}

/**
 * THE POOL TAB — the drawer's default: search, the six position stickers, and the ranked list of
 * who is left. Each row carries the market gap (the one figure with a real comparison behind it)
 * and a GENERIC edge count; the name opens the peek for everything deeper.
 */
export function DrawerPoolTab({ players, available, byeWeeks, reasons, focusSearch, needs, canDraft, submitting, queuedPlayerIds, onDraft, onQueueToggle, onPeek }: DrawerPoolTabProps) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<string>(ALL);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (focusSearch) searchRef.current?.focus();
  }, [focusSearch]);

  const ranks = useMemo(() => positionRanks(players), [players]);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return players
      .map((player, index) => ({ player, rank: index + 1 }))
      .filter(({ player }) => available.has(player.id))
      .filter(({ player }) => (position === ALL || player.position === position) && (needle === "" || player.name.toLowerCase().includes(needle)));
  }, [players, available, query, position]);
  const visible = rows.slice(0, DRAFT_ROOM_CONFIG.poolPageSize);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={searchRef}
          type="search"
          aria-label="Search players"
          placeholder="Search · press / anywhere"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 rounded-sm border border-edge bg-surface-inset px-3 py-1.5 text-sm text-text-primary placeholder:text-text-faint focus-visible:outline-2 focus-visible:outline-accent"
        />
        <div role="group" aria-label="Filter by position" className="flex items-center gap-1">
          {POSITIONS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={position === candidate}
              aria-label={`Show ${candidate} only`}
              onClick={() => setPosition(position === candidate ? ALL : candidate)}
              className={`rounded-sm p-0.5 focus-visible:outline-2 focus-visible:outline-accent ${position === candidate ? "ring-2 ring-accent" : ""}`}
            >
              <PositionBadge position={candidate} size="sm" />
            </button>
          ))}
        </div>
        {/* Need fractions ride the filter chips (WarmQuilt mock): a satisfied position reads
            quiet with its check, an open one carries its number in the negative channel. */}
        {needs === undefined || needs.length === 0 ? null : (
          <div data-testid="need-chips" className="ml-auto flex items-center gap-1.5">
            {needs.map((fraction) => (
              <span
                key={fraction.position}
                data-satisfied={fraction.satisfied}
                className={`rounded-pill bg-surface-inset px-2.5 py-1 text-xs tabular-nums ${fraction.satisfied ? "text-text-faint" : "text-text-muted"}`}
              >
                {fraction.position}{" "}
                <span className={fraction.satisfied ? "" : "text-negative"}>
                  {fraction.filled}/{fraction.total}
                </span>
                {fraction.satisfied ? " ✓" : ""}
              </span>
            ))}
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="No players match"
          description="Try a different name or position."
          icon="search"
          action={
            <Button
              variant="secondary"
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
          {visible.map(({ player, rank }, index) => {
            const adp = formatAdp(player.adp);
            const bye = byeWeeks.get(player.nflTeam);
            const gap = player.adp === null ? 0 : Math.round(player.adp) - rank;
            const edges = edgeSummary(reasons.get(player.id) ?? []);
            const queued = queuedPlayerIds.has(player.id);
            return (
              <DrawerRow
                key={player.id}
                player={player}
                rank={rank}
                positionRank={ranks.get(player.id)}
                highlight={index === 0}
                onPeek={onPeek}
                meta={
                  <>
                    {player.nflTeam}
                    {bye === undefined ? "" : ` · Bye ${bye}`}
                    {adp === null ? "" : ` · ${adp}`}
                  </>
                }
                verdict={
                  <>
                    {/* The edge count is a desktop luxury: a 390pt row spends its width on the
                        name, the meta and the verb, and the peek carries the edges. */}
                    {edges === null ? null : (
                      <span className="hidden md:inline">
                        <Badge tone="neutral">{edges.split(" · ")[0]}</Badge>
                      </span>
                    )}
                    {gap === 0 ? null : <Movement places={gap} against="the market" />}
                  </>
                }
                actions={
                  <>
                    <Button size="sm" variant="ghost" disabled={submitting} aria-label={queued ? `Remove ${player.name} from your queue` : `Add ${player.name} to your queue`} onClick={() => onQueueToggle(player.id)}>
                      <span aria-hidden="true" className={queued ? "text-accent" : "text-text-muted"}>
                        {queued ? "★" : "☆"}
                      </span>
                    </Button>
                    {canDraft ? (
                      <Button size="sm" variant="verb" disabled={submitting} onClick={() => onDraft(player.id)}>
                        Draft
                      </Button>
                    ) : null}
                  </>
                }
              />
            );
          })}
        </ol>
      )}
      {rows.length > visible.length ? (
        <p className="shrink-0 font-mono text-xs tabular-nums text-text-muted">
          Showing the top {visible.length} of {rows.length}. Narrow your search to see more.
        </p>
      ) : null}
    </div>
  );
}
