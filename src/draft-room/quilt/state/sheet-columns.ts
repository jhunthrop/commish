import type { Player, Position } from "@/domain/player";
import type { SurvivalOdds, TierStandingView } from "@/draft-service/assistant/view";
import { reuseListItems } from "@/design/reuse-list-items";
import { QUILT_CONFIG } from "./config";

/**
 * YOUR SHEET'S SEVEN COLUMNS (founder ruling 1, 2026-09-10): Overall, QB, RB, WR, TE, K, D/ST,
 * each up to fifty deep in the manager's own order, tiers as bands inside a position column,
 * taken players struck in place, your own picks marked, one odds number per row. Pure over the
 * room's facts so the bands, the counts and the window math are testable without a DOM, and
 * so the component only paints.
 */
export const SHEET_COLUMNS = ["overall", "QB", "RB", "WR", "TE", "K", "DEF"] as const;
export type SheetColumnKey = (typeof SHEET_COLUMNS)[number];

export const SHEET_COLUMN_LABEL: Readonly<Record<SheetColumnKey, string>> = {
  overall: "Overall",
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  DEF: "D/ST",
};

/** K and D/ST carry no tiers (ruling 1): a kicker ladder would be a rung per name. */
const TIERLESS: ReadonlySet<SheetColumnKey> = new Set(["overall", "K", "DEF"]);

export interface SheetRowModel {
  readonly player: Player;
  /** 1-based place in the column's FULL list: hiding taken rows never renumbers a sheet. */
  readonly rank: number;
  readonly taken: boolean;
  readonly mine: boolean;
  readonly queued: boolean;
  /** Runs in which he was still there at your next turn; undefined for a taken player or before odds arrive. */
  readonly survived: number | undefined;
  readonly runs: number | null;
}

export interface SheetBand {
  readonly key: string;
  /** "Tier 2", or null for the one band of a tierless column and for the unranked tail. */
  readonly tier: number | null;
  /** Available rows in the band, and rows in the band: "3 of 5 left" from what the column shows. */
  readonly left: number;
  readonly size: number;
  readonly rows: readonly SheetRowModel[];
}

export interface SheetColumnModel {
  readonly key: SheetColumnKey;
  readonly label: string;
  readonly bands: readonly SheetBand[];
  /** Available players among the column's rows, and the column's row count. */
  readonly left: number;
  readonly total: number;
}

export interface SheetColumnsInput {
  /** The manager's own order, best first (`CheatSheet.order`). */
  readonly order: readonly string[];
  readonly playersById: ReadonlyMap<string, Player>;
  readonly available: ReadonlySet<string>;
  readonly myPlayerIds: ReadonlySet<string>;
  readonly queuedPlayerIds: ReadonlySet<string>;
  /** Tier standings for players still on the board, plus every standing this room has seen. */
  readonly tiers: Readonly<Record<string, TierStandingView>>;
  readonly odds: SurvivalOdds | null;
  readonly hideTaken: boolean;
  readonly columnSize?: number;
}

function rowOf(player: Player, rank: number, input: SheetColumnsInput): SheetRowModel {
  const taken = !input.available.has(player.id);
  const runs = input.odds === null || input.odds.runs === 0 ? null : input.odds.runs;
  return {
    player,
    rank,
    taken,
    mine: input.myPlayerIds.has(player.id),
    queued: input.queuedPlayerIds.has(player.id),
    survived: taken || input.odds === null ? undefined : input.odds.survived[player.id],
    runs,
  };
}

/**
 * Which tier each row sits in. A row with a standing keeps it; a row without one (taken before
 * this room opened, so the advisor never ranked him for us) takes the tier of the next ranked
 * row below it, because tiers run contiguously down a position's order. Rows after the last
 * ranked one are the unranked tail.
 */
function tierByRow(rows: readonly SheetRowModel[], tiers: Readonly<Record<string, TierStandingView>>): readonly (number | null)[] {
  const known = rows.map((row) => tiers[row.player.id]?.tier ?? null);
  const assigned: (number | null)[] = new Array<number | null>(rows.length).fill(null);
  let next: number | null = null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (known[index] !== null) next = known[index];
    assigned[index] = next;
  }
  return assigned;
}

/**
 * A position column's bands, tier by tier. Our board's order interleaves tiers within a position
 * (a third-tier quarterback can outrank a second-tier one on points over replacement), so rows
 * are grouped by tier first and keep the manager's order inside a band; the rank printed on a row
 * is still his place in the manager's order, so a disagreement between the order and the tiers
 * stays visible. The unranked tail (no tier) closes the column.
 */
function bandsOf(key: SheetColumnKey, rows: readonly SheetRowModel[], tiers: Readonly<Record<string, TierStandingView>>): readonly SheetBand[] {
  const tiersOfRows = TIERLESS.has(key) ? rows.map(() => null) : tierByRow(rows, tiers);
  const byTier = new Map<number | null, SheetRowModel[]>();
  rows.forEach((row, index) => {
    const tier = tiersOfRows[index] ?? null;
    byTier.set(tier, [...(byTier.get(tier) ?? []), row]);
  });
  const bands = [...byTier.entries()].map(([tier, bandRows]) => ({ tier, rows: bandRows })).sort((a, b) => (a.tier ?? Number.POSITIVE_INFINITY) - (b.tier ?? Number.POSITIVE_INFINITY));
  return bands.map((band) => ({
    key: band.tier === null ? `${key}:unranked` : `${key}:tier:${band.tier}`,
    tier: band.tier,
    left: band.rows.filter((row) => !row.taken).length,
    size: band.rows.length,
    rows: band.rows,
  }));
}

function columnRows(key: SheetColumnKey, input: SheetColumnsInput, size: number): readonly SheetRowModel[] {
  const rows: SheetRowModel[] = [];
  for (const playerId of input.order) {
    if (rows.length >= size) break;
    const player = input.playersById.get(playerId);
    if (player === undefined) continue;
    if (key !== "overall" && player.position !== (key as Position)) continue;
    rows.push(rowOf(player, rows.length + 1, input));
  }
  return rows;
}

export function buildSheetColumns(input: SheetColumnsInput): readonly SheetColumnModel[] {
  const size = input.columnSize ?? QUILT_CONFIG.sheet.columnSize;
  return SHEET_COLUMNS.map((key) => {
    const rows = columnRows(key, input, size);
    const bands = bandsOf(key, rows, input.tiers);
    const shown = input.hideTaken ? bands.map((band) => ({ ...band, rows: band.rows.filter((row) => !row.taken) })).filter((band) => band.rows.length > 0) : bands;
    return {
      key,
      label: SHEET_COLUMN_LABEL[key],
      bands: shown,
      left: rows.filter((row) => !row.taken).length,
      total: rows.length,
    };
  });
}

const rowKey = (row: SheetRowModel): string => row.player.id;

/**
 * STABLE IDENTITY ACROSS PICKS (ruling 4: one row re-rendered per pick). `buildSheetColumns` is
 * pure and rebuilds every row, band and column object on every view, which is right for a
 * derivation and wrong for 350 memoized rows. This hands back the previous row object wherever
 * its fields did not change (`reuseListItems`), the previous band wherever its rows and counts
 * did not, the previous column wherever its bands did not, and the previous array itself when
 * nothing changed at all. A pick landing then changes exactly the rows it touched: the taken
 * man's, and the bands and columns that hold him.
 */
export function reuseSheetColumns(previous: readonly SheetColumnModel[] | null, next: readonly SheetColumnModel[]): readonly SheetColumnModel[] {
  if (previous === null) return next;
  const priorColumns = new Map(previous.map((column) => [column.key, column] as const));
  let columnsUnchanged = previous.length === next.length;
  const columns = next.map((column, index) => {
    const prior = priorColumns.get(column.key);
    if (prior === undefined) {
      columnsUnchanged = false;
      return column;
    }
    const priorBands = new Map(prior.bands.map((band) => [band.key, band] as const));
    let bandsUnchanged = prior.bands.length === column.bands.length;
    const bands = column.bands.map((band, bandIndex) => {
      const priorBand = priorBands.get(band.key);
      const rows = reuseListItems(priorBand?.rows ?? null, band.rows, rowKey);
      if (priorBand !== undefined && rows === priorBand.rows && priorBand.tier === band.tier && priorBand.left === band.left && priorBand.size === band.size) {
        if (prior.bands[bandIndex] !== priorBand) bandsUnchanged = false;
        return priorBand;
      }
      bandsUnchanged = false;
      return rows === band.rows ? band : { ...band, rows };
    });
    if (bandsUnchanged && prior.left === column.left && prior.total === column.total && prior.label === column.label) {
      if (previous[index] !== prior) columnsUnchanged = false;
      return prior;
    }
    columnsUnchanged = false;
    return { ...column, bands };
  });
  return columnsUnchanged ? previous : columns;
}

/** One entry of a column's rendered list: a band header, or a row. */
export type SheetListItem = { readonly kind: "band"; readonly band: SheetBand } | { readonly kind: "row"; readonly row: SheetRowModel; readonly band: SheetBand };

export interface SheetListLayout {
  readonly items: readonly SheetListItem[];
  /** Each item's top edge, px, and the list's whole height. */
  readonly offsets: readonly number[];
  readonly height: number;
}

/** The column flattened for the window, a header only where a band has a tier to name. */
export function layoutColumn(column: SheetColumnModel): SheetListLayout {
  const items: SheetListItem[] = [];
  const offsets: number[] = [];
  let top = 0;
  for (const band of column.bands) {
    if (band.tier !== null) {
      items.push({ kind: "band", band });
      offsets.push(top);
      top += QUILT_CONFIG.sheet.bandPx;
    }
    for (const row of band.rows) {
      items.push({ kind: "row", row, band });
      offsets.push(top);
      top += QUILT_CONFIG.sheet.rowPx;
    }
  }
  return { items, offsets, height: top };
}

export interface ListWindow {
  readonly start: number;
  readonly end: number;
}

/** The item indexes worth rendering for a scroll position, with overscan either side. */
export function windowFor(layout: SheetListLayout, scrollTop: number, viewportPx: number): ListWindow {
  const { offsets } = layout;
  if (offsets.length === 0) return { start: 0, end: 0 };
  let start = 0;
  while (start < offsets.length - 1 && offsets[start + 1]! <= scrollTop) start += 1;
  let end = start;
  while (end < offsets.length && offsets[end]! < scrollTop + viewportPx) end += 1;
  const overscan = QUILT_CONFIG.sheet.overscanRows;
  return { start: Math.max(0, start - overscan), end: Math.min(offsets.length, end + overscan) };
}

/** The band a scrolled column is inside: the last band header at or above the scroll top. */
export function bandAt(layout: SheetListLayout, scrollTop: number): SheetBand | null {
  let current: SheetBand | null = null;
  for (let index = 0; index < layout.items.length; index += 1) {
    if (layout.offsets[index]! > scrollTop) break;
    const item = layout.items[index]!;
    if (item.kind === "band") current = item.band;
  }
  return current === null || current.tier === null ? null : current;
}

/** Where the next open tier below the scroll position starts, or null when none is left. */
export function nextOpenTierOffset(layout: SheetListLayout, scrollTop: number): number | null {
  for (let index = 0; index < layout.items.length; index += 1) {
    const item = layout.items[index]!;
    if (item.kind === "band" && item.band.left > 0 && layout.offsets[index]! > scrollTop) return layout.offsets[index]!;
  }
  return null;
}

/** "3 moves of yours": how many players sit off the place our board gives them. */
export function movesOffBoard(order: readonly string[], boardIds: readonly string[]): number {
  let moved = 0;
  const limit = Math.min(order.length, boardIds.length);
  for (let index = 0; index < limit; index += 1) if (order[index] !== boardIds[index]) moved += 1;
  return moved;
}
