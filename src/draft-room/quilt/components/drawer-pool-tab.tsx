"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Player, Position } from "@/domain/player";
import type { BoardReason } from "@/projections/preseason/board";
import type { SurvivalOdds, TierStandingView } from "@/draft-service/assistant/view";
import { Badge, Button, EmptyState, Movement, PositionBadge } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { OddsPercent } from "../../advisor/components/odds-percent";
import { groupByTier } from "../../advisor/tier-groups";
import { DRAFT_ROOM_CONFIG } from "../../state/config";
import type { NeedFraction } from "../state/lens";
import { marketOrderNoteFor } from "../../lib/market-order-note";
import { formatAdp, positionRanks } from "../../lib/tiers";
import { edgeSummary } from "./peek-sheet";
import { DrawerRow } from "./drawer-row";
import type { RoomActs } from "./room-acts";

const ALL = "ALL";
const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

export interface DrawerPoolTabProps extends RoomActs {
  readonly leagueId: string;
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
  /** The advisor's next-turn odds for every undrafted player; `null` while none are held or the
   *  viewer has no next turn, and then no row prints one. */
  readonly odds?: SurvivalOdds | null;
  /** The advisor's tier standings; a position-filtered list groups under them. */
  readonly tiers?: Readonly<Record<string, TierStandingView>>;
}

interface PoolRow {
  readonly player: Player;
  readonly rank: number;
}

/**
 * THE POOL TAB — the drawer's default: search, the six position stickers, and the ranked list of
 * who is left. Each row carries the market gap (the one figure with a real comparison behind it)
 * and a GENERIC edge count; the name opens the season peek (`PlayerName`), and the row's own
 * "Card" button opens this room's own draft-context card for everything deeper.
 */
export function DrawerPoolTab({ leagueId, players, available, byeWeeks, reasons, focusSearch, needs, odds = null, tiers = {}, canDraft, submitting, queuedPlayerIds, onDraft, onQueueToggle, onPeek }: DrawerPoolTabProps) {
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
  // Tier headers only over ONE position: a mixed list has no single ladder to group under.
  const groups = useMemo(() => (position === ALL ? [{ header: null, rows: visible }] : groupByTier<PoolRow>(visible, (row) => row.player.id, tiers)), [position, visible, tiers]);
  // Only while a single position is selected: the note is about THAT position, and printing it over
  // the mixed ALL list would be attaching a claim to rows it is not about.
  const marketOrderNote = position === ALL ? null : marketOrderNoteFor(position as Position);

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

      {/* A position the engine publishes no projection for says so, once, above its own rows. A tab
          of rows with no numbers and no sentence reads as a bug, and a manager who thinks the board
          is broken trusts the rest of it less. `null` for every position that does carry one. */}
      {marketOrderNote === null ? null : (
        <p data-testid="market-order-note" className="rounded-sm bg-surface-inset px-3 py-2 text-xs text-text-muted">
          {marketOrderNote}
        </p>
      )}

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
          {groups.flatMap((group, groupIndex) => [
            ...(group.header === null
              ? []
              : [
                  <li key={`tier:${group.header}`} data-testid="advisor-tier-header" className={`${MICRO_LABEL} px-2.5 pt-2 text-text-faint`}>
                    {group.header}
                  </li>,
                ]),
            ...group.rows.map(({ player, rank }, index) => {
              const adp = formatAdp(player.adp);
              const bye = byeWeeks.get(player.nflTeam);
              const gap = player.adp === null ? 0 : Math.round(player.adp) - rank;
              const edges = edgeSummary(reasons.get(player.id) ?? []);
              const queued = queuedPlayerIds.has(player.id);
              return (
                <DrawerRow
                  key={player.id}
                  leagueId={leagueId}
                  player={player}
                  rank={rank}
                  positionRank={ranks.get(player.id)}
                  highlight={groupIndex === 0 && index === 0}
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
                      {gap === 0 ? null : <Movement places={gap} against="ADP" />}
                      {odds === null ? null : <OddsPercent odds={odds} playerId={player.id} />}
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
            }),
          ])}
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
