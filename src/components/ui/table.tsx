import type { ReactNode } from "react";

export interface TableColumn<T> {
  readonly key: string;
  readonly header: string;
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
  /** Required: a table with no rows must still offer the reader a next step. */
  readonly empty: ReactNode;
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
export function Table<T>({ caption, captionVisible = false, columns, rows, rowKey, rowClassName, empty }: TableProps<T>) {
  if (rows.length === 0) return <>{empty}</>;

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-sm text-text-primary">
        <caption className={captionVisible ? "mb-2 text-left text-sm font-medium text-text-muted" : "sr-only"}>{caption}</caption>
        <thead>
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th key={column.key} scope="col" className={`${columnClass(column)}px-3 py-2 font-medium text-text-muted`}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={`border-b border-border/50 ${rowClassName?.(row) ?? ""}`}>
              {columns.map((column) => (
                <td key={column.key} className={`${columnClass(column)}px-3 py-2`}>
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
