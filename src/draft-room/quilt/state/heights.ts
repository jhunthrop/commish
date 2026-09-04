import type { QuiltRowKind } from "./board";

/**
 * THE QUILT'S HEIGHT MODEL — the zero-scroll law (all rounds visible at every drawer height)
 * as arithmetic. `buildQuiltRows` decides each round's KIND; this module decides each round's
 * exact pixel height for the stage the board actually got, so every cell in a row can share
 * that row's ONE height and rows can never overlap or spill. Pure on purpose: the degradation
 * ladder is testable per available-height scenario without a DOM, and the component only paints
 * what the plan says.
 *
 * The ladder, in order, when the stage is too short for the preferred layout:
 *   1. the manager row goes compact (avatars shrink, its labels drop);
 *   2. track and micro rows squeeze from their preferred height toward their floor, while the
 *      full window (the active round plus the prior three, since the 2026-09-03 roster pass)
 *      holds its readable preferred — a row that drops under `labelMinPx` hands its R-label to
 *      screen readers only (labels HIDE below the threshold; they never overlap);
 *   3. the window's own rows shrink, down to their floor;
 *   4. last resort, every floor scales proportionally — still zero overlap, still zero scroll.
 */
export const BOARD_HEIGHTS = {
  /** The board flex column's `gap-1.5`, in px — the model must count what the CSS spends. */
  gapPx: 6,
  /** The header row above the rounds: manager faces (full / compact) or the phone's codes. */
  headerPx: { manager: 48, managerCompact: 28, codes: 18 },
  /** The NEEDS lens's dot row — fixed, present only while that lens is on. */
  needsRowPx: 32,
  /** Per-kind row geometry: preferred is the height a squeezed stage still tries to honor,
   *  max is the roomy-stage cap, floor is the squeeze limit. Retuned for the four-round window
   *  (founder ruling 2026-09-03): full cards run a tighter two-line lockup at 36px preferred
   *  (down from 44) capped at 56 (a 96px ceiling was a card with air), the track's cap stays
   *  under the full cap (an empty upcoming row must never outstand the cards it will become),
   *  and the compacted past floors at 4 (down from 6) — eleven micro rows paying 2px each is
   *  what keeps all four window rows at the 28px readable floor on a short laptop with the
   *  drawer at half. */
  row: {
    full: { max: 56, preferred: 36, floor: 28, weight: 3 },
    track: { max: 48, preferred: 14, floor: 4, weight: 2 },
    micro: { max: 28, preferred: 14, floor: 4, weight: 1 },
  },
  /** A micro tile's own cap inside its row (the design's 14px sliver, `max-h-3.5`). */
  microTilePx: 14,
  /** Rows shorter than this hide their R-label (sr-only survives). Never overlap, ever. */
  labelMinPx: 14,
  /** Rows shorter than this drop the label to the 10px face instead of text-xs. */
  labelSmallPx: 24,
  /** Full/track cells drop their second line (fact / caption) under this row height — 30 so
   *  the tighter lockup's fact line survives at the 36px preferred card… */
  cellCaptionMinPx: 30,
  /** …and their primary text line under this one — a dashed YOURS cell keeps its amber
   *  dashed border as its whole identity below it (fix requirement 1). */
  cellTextMinPx: 20,
  /** A window cell stops carrying the 32px player face under this row height — the face is
   *  the first thing a shrinking card sheds, before either text line. */
  cellFaceMinPx: 34,
  /** Assumed stage height for the first paint, before the ResizeObserver's real number. */
  defaultBoardPx: 800,
} as const;

/** What rides above the rounds: the desktop manager faces or the phone board's code row. */
export type BoardHeader = "manager" | "codes";

export interface HeightPlanInput {
  /** The measured height of the whole board column (header + optional needs row + rounds). */
  readonly boardHeight: number;
  readonly kinds: readonly QuiltRowKind[];
  readonly header: BoardHeader;
  readonly needsRow: boolean;
}

export interface RowHeightPlan {
  /** The row's ONE height, in px — every cell in the row renders at exactly this. */
  readonly height: number;
  /** False under `labelMinPx`: the R-label leaves the stage (sr-only stays). */
  readonly label: boolean;
}

export interface BoardHeightPlan {
  /** True when step 1 of the ladder fired: the manager row must render compact. */
  readonly managerCompact: boolean;
  readonly rows: readonly RowHeightPlan[];
}

const ROW = BOARD_HEIGHTS.row;

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** The px left for round rows once the header, the needs row and every gap are paid for. */
function roundsBudget(input: HeightPlanInput, managerCompact: boolean): number {
  const headerPx =
    input.header === "codes" ? BOARD_HEIGHTS.headerPx.codes : managerCompact ? BOARD_HEIGHTS.headerPx.managerCompact : BOARD_HEIGHTS.headerPx.manager;
  const childCount = 1 + (input.needsRow ? 1 : 0) + input.kinds.length;
  return input.boardHeight - headerPx - (input.needsRow ? BOARD_HEIGHTS.needsRowPx : 0) - (childCount - 1) * BOARD_HEIGHTS.gapPx;
}

const toPlan = (height: number): RowHeightPlan => ({ height, label: height >= BOARD_HEIGHTS.labelMinPx });

/**
 * The roomy branch: every row starts at its preferred height, and the surplus waterfills by
 * weight (the active round drinks hardest) until each row hits its cap. Any px the caps cannot
 * absorb stay as slack — the same ceiling the old max-h classes drew.
 */
function grow(kinds: readonly QuiltRowKind[], budget: number): readonly RowHeightPlan[] {
  const heights: number[] = kinds.map((kind) => ROW[kind].preferred);
  let remaining = budget - sum(heights);
  // Each pass freezes at least one row at its cap, so `kinds.length` passes always suffice.
  for (let pass = 0; pass < kinds.length && remaining > 0.5; pass += 1) {
    const open = kinds.map((kind, index) => index).filter((index) => heights[index]! < ROW[kinds[index]!].max);
    if (open.length === 0) break;
    const totalWeight = sum(open.map((index) => ROW[kinds[index]!].weight));
    let spent = 0;
    for (const index of open) {
      const spec = ROW[kinds[index]!];
      const add = Math.min(spec.max - heights[index]!, (remaining * spec.weight) / totalWeight);
      heights[index] = heights[index]! + add;
      spent += add;
    }
    remaining -= spent;
    if (spent < 0.5) break;
  }
  return heights.map(toPlan);
}

/**
 * The squeezed branch (budget below the preferred total): the active round holds its readable
 * preferred height while every other row shares what remains evenly, floored; then the active
 * round gives ground to its own floor; then everything scales. Deterministic at every step.
 */
function squeeze(kinds: readonly QuiltRowKind[], budget: number): readonly RowHeightPlan[] {
  const fullCount = kinds.filter((kind) => kind === "full").length;
  const otherCount = kinds.length - fullCount;
  let fullPx: number = ROW.full.preferred;
  let otherPx = otherCount === 0 ? 0 : (budget - fullCount * fullPx) / otherCount;
  if (otherPx < ROW.micro.floor) {
    otherPx = ROW.micro.floor;
    fullPx = fullCount === 0 ? 0 : (budget - otherCount * otherPx) / fullCount;
    if (fullPx < ROW.full.floor) {
      const floorTotal = fullCount * ROW.full.floor + otherCount * ROW.micro.floor;
      const scale = floorTotal <= 0 ? 0 : Math.max(0, budget) / floorTotal;
      return kinds.map((kind) => toPlan((kind === "full" ? ROW.full.floor : ROW.micro.floor) * scale));
    }
  }
  return kinds.map((kind) => toPlan(kind === "full" ? fullPx : otherPx));
}

/** The whole model: one measured height in, one deterministic set of row heights out. */
export function planBoardHeights(input: HeightPlanInput): BoardHeightPlan {
  const preferredTotal = sum(input.kinds.map((kind) => ROW[kind].preferred));
  const roomyBudget = roundsBudget(input, false);
  if (roomyBudget >= preferredTotal) return { managerCompact: false, rows: grow(input.kinds, roomyBudget) };
  // Ladder step 1: only the manager header has a compact form to give; the codes header holds.
  const managerCompact = input.header === "manager";
  const budget = managerCompact ? roundsBudget(input, true) : roomyBudget;
  return { managerCompact, rows: budget >= preferredTotal ? grow(input.kinds, budget) : squeeze(input.kinds, budget) };
}
