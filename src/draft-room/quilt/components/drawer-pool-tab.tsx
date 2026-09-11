"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import type { Player, Position } from "@/domain/player";
import type { BoardReason } from "@/projections/preseason/board";
import type { SurvivalOdds, TierStandingView } from "@/draft-service/assistant/view";
import { Badge, Button, MotionList, Movement, type MotionRowProps } from "@/components/ui";
import { MICRO_LABEL } from "@/components/ui/config";
import { useStableList } from "@/design/use-stable-list";
import { OddsFigure } from "../../advisor/components/odds-glance";
import { groupByTier } from "../../advisor/tier-groups";
import { DRAFT_ROOM_CONFIG } from "../../state/config";
import type { NeedFraction } from "../state/lens";
import { marketOrderNoteFor } from "../../lib/market-order-note";
import { formatAdp, positionRanks } from "../../lib/tiers";
import { edgeSummary } from "./peek-sheet";
import { ALL_POSITIONS, DrawerFilterEmpty, DrawerFilterRow, useDrawerFilter } from "./drawer-filter";
import { DrawerRow } from "./drawer-row";
import type { RoomActs } from "./room-acts";

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

interface PoolRowModel {
  readonly player: Player;
  readonly rank: number;
}

/** One entry of the rendered list: a tier header, or a player row with every fact it prints
 *  resolved to a primitive, so the memoized `PoolRow` below re-renders only when one changed. */
type PoolListItem =
  | { readonly kind: "header"; readonly header: string }
  | {
      readonly kind: "row";
      readonly player: Player;
      readonly rank: number;
      readonly positionRank: number | undefined;
      readonly highlight: boolean;
      readonly bye: number | undefined;
      readonly gap: number;
      readonly edge: string | null;
      readonly survived: number | undefined;
      readonly runs: number | null;
    };

const keyOf = (item: PoolListItem): string => (item.kind === "header" ? `tier:${item.header}` : item.player.id);

function rowItem(row: PoolRowModel, highlight: boolean, ranks: ReadonlyMap<string, number>, byeWeeks: ReadonlyMap<string, number>, reasons: ReadonlyMap<string, readonly BoardReason[]>, odds: SurvivalOdds | null): PoolListItem {
  const { player, rank } = row;
  const edges = edgeSummary(reasons.get(player.id) ?? []);
  return {
    kind: "row",
    player,
    rank,
    positionRank: ranks.get(player.id),
    highlight,
    bye: byeWeeks.get(player.nflTeam),
    gap: player.adp === null ? 0 : Math.round(player.adp) - rank,
    edge: edges === null ? null : (edges.split(" · ")[0] ?? null),
    survived: odds === null ? undefined : odds.survived[player.id],
    runs: odds === null || odds.runs === 0 ? null : odds.runs,
  };
}

interface PoolRowProps extends Pick<RoomActs, "canDraft" | "submitting" | "onDraft" | "onQueueToggle" | "onPeek"> {
  readonly leagueId: string;
  readonly item: Extract<PoolListItem, { kind: "row" }>;
  readonly queued: boolean;
  readonly row: MotionRowProps;
}

/** One pool row over primitives: a pick landing re-renders the row that left and nothing else. */
const PoolRow = memo(function PoolRow({ leagueId, item, queued, canDraft, submitting, onDraft, onQueueToggle, onPeek, row }: PoolRowProps) {
  const { player, rank, positionRank, highlight, bye, gap, edge, survived, runs } = item;
  const adp = formatAdp(player.adp);
  return (
    <DrawerRow
      leagueId={leagueId}
      player={player}
      rank={rank}
      positionRank={positionRank}
      highlight={highlight}
      onPeek={onPeek}
      row={row}
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
          {edge === null ? null : (
            <span className="hidden md:inline">
              <Badge tone="neutral">{edge}</Badge>
            </span>
          )}
          {gap === 0 ? null : <Movement places={gap} against="ADP" />}
          {runs === null || survived === undefined ? null : <OddsFigure survived={survived} runs={runs} />}
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
});

/**
 * THE POOL TAB — the drawer's default: search, the six position stickers, and the ranked list of
 * who is left. Each row carries the market gap (the one figure with a real comparison behind it)
 * and a GENERIC edge count; the name opens the season peek (`PlayerName`), and the row's own
 * "Card" button opens this room's own draft-context card for everything deeper.
 *
 * ROWS MOVE, THEY DO NOT POP (fluidity round, 2026-09-10): the list rides `MotionList`, so the
 * row a pick took fades out in place, the row that slides into the window fades in, and
 * everything between glides; each row is memoized over primitives, so sixty rows cost one
 * row's render per pick.
 */
export function DrawerPoolTab({ leagueId, players, available, byeWeeks, reasons, focusSearch, needs, odds = null, tiers = {}, canDraft, submitting, queuedPlayerIds, onDraft, onQueueToggle, onPeek }: DrawerPoolTabProps) {
  const filter = useDrawerFilter();
  const { position, matches } = filter;
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (focusSearch) searchRef.current?.focus();
  }, [focusSearch]);

  const ranks = useMemo(() => positionRanks(players), [players]);
  const rows = useMemo(
    () =>
      players
        .map((player, index) => ({ player, rank: index + 1 }))
        .filter(({ player }) => available.has(player.id) && matches(player)),
    [players, available, matches],
  );
  const visible = useMemo(() => rows.slice(0, DRAFT_ROOM_CONFIG.poolPageSize), [rows]);
  // Tier headers only over ONE position: a mixed list has no single ladder to group under.
  const built = useMemo((): readonly PoolListItem[] => {
    const groups = position === ALL_POSITIONS ? [{ header: null, rows: visible }] : groupByTier<PoolRowModel>(visible, (row) => row.player.id, tiers);
    return groups.flatMap((group, groupIndex) => [
      ...(group.header === null ? [] : [{ kind: "header", header: group.header } as const]),
      ...group.rows.map((row, index) => rowItem(row, groupIndex === 0 && index === 0, ranks, byeWeeks, reasons, odds)),
    ]);
  }, [position, visible, tiers, ranks, byeWeeks, reasons, odds]);
  const items = useStableList(built, keyOf);
  // Only while a single position is selected: the note is about THAT position, and printing it over
  // the mixed ALL list would be attaching a claim to rows it is not about.
  const marketOrderNote = position === ALL_POSITIONS ? null : marketOrderNoteFor(position as Position);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <DrawerFilterRow filter={filter} searchRef={searchRef}>
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
      </DrawerFilterRow>

      {/* A position the engine publishes no projection for says so, once, above its own rows. A tab
          of rows with no numbers and no sentence reads as a bug, and a manager who thinks the board
          is broken trusts the rest of it less. `null` for every position that does carry one. */}
      {marketOrderNote === null ? null : (
        <p data-testid="market-order-note" className="rounded-sm bg-surface-inset px-3 py-2 text-xs text-text-muted">
          {marketOrderNote}
        </p>
      )}

      {visible.length === 0 ? (
        <DrawerFilterEmpty filter={filter} />
      ) : (
        <ol aria-label="Available players, best first" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          <MotionList items={items} keyOf={keyOf}>
            {(item, row) =>
              item.kind === "header" ? (
                <li {...row} data-testid="advisor-tier-header" className={`${MICRO_LABEL} px-2.5 pt-2 text-text-faint ${row.className}`}>
                  {item.header}
                </li>
              ) : (
                <PoolRow
                  leagueId={leagueId}
                  item={item}
                  queued={queuedPlayerIds.has(item.player.id)}
                  canDraft={canDraft}
                  submitting={submitting}
                  onDraft={onDraft}
                  onQueueToggle={onQueueToggle}
                  onPeek={onPeek}
                  row={row}
                />
              )
            }
          </MotionList>
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
