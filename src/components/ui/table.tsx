import type { ReactNode } from "react";
import { UI_CONFIG } from "./config";

export type TableDensity = "comfortable" | "dense";

/**
 * `comfortable` keeps the table's original Tailwind padding class; `dense` is the mocks' own
 * 11px spec (`UI_CONFIG.table.denseRowPaddingPx`), applied as an inline style rather than a
 * templated `py-[…px]` class — the same "a dynamic value has to reach the DOM as a style, not a
 * class" idiom `UI_CONFIG.infoTip.minTargetPx` already uses, since a templated arbitrary-value
 * class is invisible to Tailwind's static content scanner and would silently ship no rule.
 */
const ROW_PADDING_CLASS: Readonly<Record<TableDensity, string>> = {
  comfortable: "py-2",
  dense: "",
};

const ROW_PADDING_STYLE: Readonly<Record<TableDensity, { readonly paddingTop?: string; readonly paddingBottom?: string }>> = {
  comfortable: {},
  dense: { paddingTop: `${UI_CONFIG.table.denseRowPaddingPx}px`, paddingBottom: `${UI_CONFIG.table.denseRowPaddingPx}px` },
};

export interface TableColumn<T> {
  readonly key: string;
  /** Almost always a plain string; a `ReactNode` is only for a header that needs its own
   *  interactive element (e.g. an `InfoTip` beside "Record") — never a substitute for `caption`,
   *  which stays the table's one required accessible name. */
  readonly header: ReactNode;
  readonly cell: (row: T) => ReactNode;
  /** Right-aligns and tabular-numbers the column. */
  readonly numeric?: boolean;
  /** Dropped below the `sm` breakpoint so the 360px layout stays readable. */
  readonly hideOnNarrow?: boolean;
}

export interface TableProps<T> {
  /** Required: the table's accessible name. */
  readonly caption: string;
  /** Show the caption above the table instead of only exposing it to assistive tech. */
  readonly captionVisible?: boolean;
  readonly columns: readonly TableColumn<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly rowClassName?: (row: T) => string;
  /** Extra attributes (e.g. `data-own`) spread directly onto the `<tr>` — never a second wrapper element. */
  readonly rowAttributes?: (row: T) => Record<string, string>;
  /** Required: a table with no rows must still offer the reader a next step. */
  readonly empty: ReactNode;
  /**
   * `dense` is the mocks' 11px vertical cell padding; `comfortable` keeps the table's original,
   * more generous padding. Defaults to `dense`.
   *
   * DENSITY-DEFAULT DECISION, CLOSED (Phase 3.6, Task 12 Step 3c, completing the P3/Task 11
   * follow-up): Task 3 shipped this default as `"comfortable"` with explicit opt-in specifically
   * so flipping it could never silently densify `matchup-panel.tsx` and `budget-table.tsx` before
   * their own retone. Task 11 converged `matchup-panel.tsx`, alongside `standings-table.tsx` and
   * `league-board.tsx`, all three passing `density="dense"` explicitly. Task 12 converges the
   * fourth and last consumer, `budget-table.tsx` — at which point every `Table` in the product
   * wants `dense` and not one wants `comfortable`, which is the moment this default was always
   * meant to flip: keeping `"comfortable"` as the default past that point would just be dead
   * configuration nobody opts into. The call, made: **`dense` is now the default**, and the
   * three now-redundant explicit `density="dense"` props (`standings-table.tsx`,
   * `league-board.tsx`, `matchup-panel.tsx`) were dropped in this same commit — `budget-table.tsx`
   * never carried one to begin with, so it needed no prop change at all, only this default. A
   * future table that genuinely wants the old, roomier padding still can, via `density=
   * "comfortable"` — the option stays, just no longer the default nobody chooses.
   */
  readonly density?: TableDensity;
}

function columnClass<T>(column: TableColumn<T>): string {
  return `${column.numeric ? "text-right tabular-nums " : "text-left "}${column.hideOnNarrow ? "hidden sm:table-cell " : ""}`;
}

/**
 * A semantic table. Real `<table>` markup (caption + scoped column headers) is what lets a
 * screen-reader user navigate a draft board cell by cell; a grid of divs does not. Scrolls
 * horizontally inside its own wrapper so the page body never scrolls sideways at the 360px
 * baseline.
 */
export function Table<T>({
  caption,
  captionVisible = false,
  columns,
  rows,
  rowKey,
  rowClassName,
  rowAttributes,
  empty,
  density = "dense",
}: TableProps<T>) {
  if (rows.length === 0) return <>{empty}</>;

  const cellPaddingClass = ROW_PADDING_CLASS[density];
  const cellPaddingStyle = ROW_PADDING_STYLE[density];

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-sm text-text-primary">
        <caption className={captionVisible ? "mb-2 text-left text-sm font-medium text-text-muted" : "sr-only"}>{caption}</caption>
        <thead>
          <tr className="border-b border-line">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={cellPaddingStyle}
                className={`${columnClass(column)}px-3 ${cellPaddingClass} font-medium text-text-muted`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={`border-b border-line/50 ${rowClassName?.(row) ?? ""}`} {...rowAttributes?.(row)}>
              {columns.map((column) => (
                <td key={column.key} style={cellPaddingStyle} className={`${columnClass(column)}px-3 ${cellPaddingClass}`}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
