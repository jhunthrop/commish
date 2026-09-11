import type { ReactNode } from "react";
import { TOKENS } from "@/design/tokens";
import { MICRO_LABEL } from "./config";
import { comparisonWithin, type HeatDirection } from "./magnitude";
import { NOT_STARTED_DASH } from "./game-state-chip";
import { Stat } from "./stat";

export type TableDensity = "comfortable" | "dense";

/**
 * A ROW'S HEIGHT IS A TOKEN, NOT A PADDING GUESS (Sideline, 2026-09-10). `TOKENS.density` states
 * Sideline's row rhythm as numbers so it cannot drift: 48px where a manager is reading
 * (`comfortable`) and 44px on a research surface where they are comparing (`dense`), the same two
 * numbers `PlayerRow` and `TeamRow` already stand at. The table used to set a vertical PADDING
 * instead, which meant its actual row height was whatever the tallest cell's content happened to
 * make it plus 28px — a standings row with a face in it and a standings row without one were two
 * different heights for no stated reason, and neither was any number in the token file.
 *
 * It reaches the DOM as an inline style rather than a templated `h-[…px]` class for the reason
 * `UI_CONFIG.infoTip.minTargetPx` already documents: Tailwind's scanner reads source text, and a
 * class built from a variable ships no rule at all. `height` on a `<td>` is a MINIMUM in the CSS
 * table model, so a cell whose content genuinely needs more room still gets it and the row simply
 * grows, which is what keeps a wrapped manager name from being clipped at 360px.
 */
const ROW_HEIGHT_PX: Readonly<Record<TableDensity, number>> = {
  comfortable: TOKENS.density.rowPx,
  dense: TOKENS.density.denseRowPx,
};

/** The horizontal breathing room stays a class; only the vertical rhythm is a token. */
const CELL_PADDING_CLASS = "px-3 py-1.5";

interface TableColumnBase {
  readonly key: string;
  /** Dropped below the `sm` breakpoint so the 360px layout stays readable. */
  readonly hideOnNarrow?: boolean;
}

/** A column the caller draws itself. */
export interface TableReadColumn<T> extends TableColumnBase {
  /** Almost always a plain string; a `ReactNode` is only for a header that needs its own
   *  interactive element (e.g. an `InfoTip` beside "Record") — never a substitute for `caption`,
   *  which stays the table's one required accessible name. */
  readonly header: ReactNode;
  readonly cell: (row: T) => ReactNode;
  /** Right-aligns and tabular-numbers the column. */
  readonly numeric?: boolean;
  readonly judged?: undefined;
}

/**
 * WHAT MAKES A COLUMN JUDGED, and the two things a caller must state to earn a tint.
 *
 * `set` is the comparison set IN WORDS, and it is one string doing two jobs on purpose. `Stat`
 * speaks it in a sentence ("Top 8% of **the league**."), and the column head prints it under the
 * label ("vs **the league**"). One field rather than two because the moment there are two, they
 * drift, and a heat map whose spoken claim and printed claim disagree is worse than one with no
 * claim at all. Phrase it so it reads after both — a bare noun phrase, no leading article beyond
 * "the", no trailing full stop.
 *
 * `value` is the number itself, separate from `format`, because the ramp ranks the value and the
 * reader reads the formatting. `null` is "this row has no number", which is a different fact from
 * zero and renders `absent` instead of a `Stat`.
 */
export interface JudgedColumn<T> {
  readonly value: (row: T) => number | null;
  /** Formatting belongs to the surface that owns the fact: a projection, a margin and a dollar
   *  round differently and this primitive never decides for them. */
  readonly format: (value: number) => string;
  readonly set: string;
  /** `lower-is-better` for the one kind of column where the biggest number is the worst one
   *  (points against, money spent). The head says so out loud; the ramp inverts. */
  readonly direction?: HeatDirection;
}

/**
 * A column whose numbers are ranked against each other and tinted on the magnitude ramp.
 *
 * `header` is a plain string here, not a `ReactNode`, and that is a real constraint rather than a
 * simplification: this head has to carry the label, the stated comparison set beneath it, and the
 * accessible name every `Stat` in the column announces. A head that also wanted an `InfoTip` is a
 * head whose column is explaining itself in prose, which is the thing the tint is meant to REPLACE.
 */
export interface TableJudgedColumn<T> extends TableColumnBase {
  readonly header: string;
  readonly judged: JudgedColumn<T>;
  /** What a row with no number shows. The dash, by default — "has not played" and "played and
   *  scored nothing" are different facts, and a number that does not exist cannot be ranked. */
  readonly absent?: ReactNode;
  readonly cell?: undefined;
}

export type TableColumn<T> = TableReadColumn<T> | TableJudgedColumn<T>;

function isJudged<T>(column: TableColumn<T>): column is TableJudgedColumn<T> {
  return column.judged !== undefined;
}

export interface TableProps<T> {
  /**
   * Claim the full width of the owning column (founder, 2026-08-30: "shouldn't that also be a
   * full width responsive experience?"). Content-sizing stays the default — it was the cure for
   * full-bleed tables spreading two related facts 1,270px apart — but inside a CAPPED column the
   * disease cannot occur, and a standings board that owns its column should fill it rather than
   * hug its left edge with a void beside it.
   */
  readonly fill?: boolean;
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

/** A judged column is numeric by construction — it ranks numbers — so it never has to say so. */
function columnClass<T>(column: TableColumn<T>): string {
  const numeric = isJudged(column) || column.numeric === true;
  return `${numeric ? "text-right tabular-nums " : "text-left "}${column.hideOnNarrow ? "hidden sm:table-cell " : ""}`;
}

/**
 * THE COMPARISON SET, STATED. Rule 1's magnitude amendment permits a tint only "where the
 * comparison is genuine and stated", and this is the stating: one quiet line under the column
 * label naming what these numbers were ranked against, so a reader never has to infer the
 * population from the fact that some of the digits are green.
 *
 * It replaces prose rather than adding it. A column that says "vs the league" under its own head
 * does not need a caption below the table explaining what the colours mean, and this pass deleted
 * the captions that were doing that job.
 */
function JudgedHead<T>({ column }: { readonly column: TableJudgedColumn<T> }) {
  const { set, direction } = column.judged;
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span>{column.header}</span>
      <span className="normal-case tracking-normal text-text-faint">
        {direction === "lower-is-better" ? `vs ${set}, lower is better` : `vs ${set}`}
      </span>
    </span>
  );
}

/**
 * THE JUDGED CELL, and the one reason this file names no magnitude colour.
 *
 * Every tinted number in a table is a `Stat`, built here and rendered by `Stat` itself, which
 * keeps `magnitude-budget.source.test.ts`'s allowlist at exactly one file — see that test's own
 * THE TABLE PATH note. It is not merely convenient: `Stat` is where colour stops being the only
 * channel. A judged value carries the caret and the weight step with the pigment, and routing the
 * table through the component is what makes it impossible for the table path to ship the tint and
 * silently drop the two channels a manager with deuteranopia is actually reading.
 *
 * `srOnlyLabel`: the `<th>` above already names this number, on screen and in the accessibility
 * tree, for every cell in the column. Printing "Points for" under each of twelve figures is the
 * document grammar this pass exists to undo.
 */
function judgedCell<T>(column: TableJudgedColumn<T>, row: T, values: readonly number[]): ReactNode {
  const value = column.judged.value(row);
  if (value === null) return column.absent ?? NOT_STARTED_DASH;
  const { format, set, direction } = column.judged;
  return (
    <Stat
      label={column.header}
      srOnlyLabel
      size="sm"
      value={format(value)}
      comparison={comparisonWithin(values, value, set, direction)}
      className="items-end"
    />
  );
}

/**
 * A semantic table. Real `<table>` markup (caption + scoped column headers) is what lets a
 * screen-reader user navigate a draft board cell by cell; a grid of divs does not. Scrolls
 * horizontally inside its own wrapper so the page body never scrolls sideways at the 360px
 * baseline.
 *
 * THE TABLE SIZES TO ITS CONTENT AND THEN STOPS (2026-08-28). This used to be `w-full`, which is
 * the default nobody chooses on purpose and which cost this product more legibility than any
 * single colour decision. A `w-full` table does not show more; it shows the same facts further
 * apart. On the league page at 1440px it put a team name at x=100 and that team's points at
 * x=1370 — twelve rows of a 1,270px eye journey between the two facts a standings row is about,
 * with nothing in the gap. Six columns spread over a desktop window read as a spreadsheet;
 * the same six hugging their own content read as a scoreboard.
 *
 * So the width is content-driven and the leftover window is left EMPTY. That is the deliberate
 * half of it: reclaimed horizontal space is not a slot waiting for a column, and a table that
 * ends at 60% of the window with nothing to its right is the shape the founder pointed at.
 *
 * NOT A PROP. There is no `width="fill"` escape hatch, for the reason this file's own
 * DENSITY-DEFAULT decision gives one paragraph down: an option no consumer chooses is dead
 * configuration, and every table in the product wants this. `max-w-full` keeps a table whose
 * content genuinely exceeds the window inside its own scrolling wrapper, so the 360px baseline
 * is unchanged.
 *
 * JUDGED COLUMNS (2026-08-28), the second half of the same change. A column may declare itself
 * judged (`TableJudgedColumn`), and then every number in it is ranked against the other numbers in
 * THAT COLUMN and rendered on the magnitude ramp. Before this, the three tables with heat each
 * wired their own `Stat`, their own `srOnlyLabel`, their own `items-end` and their own population
 * array — four chances per column to ship a tint that was subtly not what the column beside it
 * meant.
 *
 * **THE SET IS THE COLUMN, AND THAT IS THE WHOLE RULE.** The population is built once per render
 * from the rows this table was handed, which is what makes the claim checkable by eye: a reader
 * comparing two green cells is comparing two members of the same set, because the set is what they
 * can see. A number ranked against something the table CANNOT see — the matchup page's starters,
 * pooled by position across every game in the week — is not a judged column and keeps its own
 * `Stat` cell. Declaring it here would silently rank a quarterback against a kicker for the crime
 * of sharing a column.
 *
 * Three guarantees the amendment asks for, and where each one lives:
 *
 * - **A tint needs a real comparison set.** `comparisonWithin` refuses below
 *   `UI_CONFIG.stat.minPopulation` and the cell renders `neutral`, which is `textPrimary`
 *   verbatim. A four-team auction gets plain money.
 * - **Colour is never the only channel.** The cell IS a `Stat`, so the caret and the weight step
 *   ship with the pigment — see `judgedCell`.
 * - **Magnitude never lands on a control.** Nothing here is pressable, and this file names no
 *   magnitude colour at all (`magnitude-budget.source.test.ts`).
 *
 * Only numeric cells are judged. A name, a sticker, a record and a slot are not rankings and are
 * not tinted.
 */
export function Table<T>({
  fill = false,
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

  const rowHeightStyle = { height: `${ROW_HEIGHT_PX[density]}px` };
  // Each judged column's own population, built ONCE per render rather than once per cell — twelve
  // cells each rebuilding the same twelve-number array is twelve scans of one column. `null` rows
  // are left out rather than folded to zero: a team that has not played is not a team that scored
  // nothing, and padding the pool with a zero would drag every real number up the ramp.
  const populations = new Map<string, readonly number[]>(
    columns
      .filter(isJudged)
      .map((column) => [column.key, rows.map((row) => column.judged.value(row)).filter((value): value is number => value !== null)]),
  );

  return (
    <div className="w-full overflow-x-auto">
      <table className={`${fill ? "w-full" : "w-auto"} max-w-full border-collapse text-base text-text-primary`}>
        <caption className={captionVisible ? "mb-2 text-left text-sm font-medium text-text-muted" : "sr-only"}>{caption}</caption>
        <thead>
          <tr className="border-b border-line">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                // `align-top`: NEW-3 (gauntlet fix wave, "reported, not fixed"), the standings
                // `Record` column's own instance of `open-league-card.tsx`'s guided-`InfoTip`
                // layout break. A `<th>`'s UA-default `vertical-align` is `middle`; every header
                // here is an ordinary single-line label EXCEPT `Record`'s (`standings-table.tsx`),
                // which also carries an `InfoTip` — a guided caller's caption grows that one
                // cell's own content past a single line, and `middle` alignment then floats every
                // OTHER header's plain one-line label at that row's new, taller vertical center,
                // detaching them from the row's top edge they shared before. `align-top` on every
                // header cell (not only `Record`'s) is a no-op for the common case — same-height
                // cells look identical top- or middle-aligned — and is what keeps the row's other
                // labels flush with `Record`'s own top edge the one time a cell actually grows.
                //
                // ONE HEAD REGISTER FOR EVERY TABLE (2026-08-28). `MICRO_LABEL` — the caps
                // charter's single sanctioned all-caps address, "where every sports interface has
                // always put it" — was already what `league-board.tsx` wrapped each of its six
                // heads in by hand, precisely because this default (sentence case, body face) is
                // what made that board read as a spreadsheet of prose. One board hand-rolling the
                // right answer while four other tables kept the wrong one is two registers for one
                // job, and the judged column is what made that visible: its head is a plain string
                // this file renders, so it had nowhere to hand-roll. The treatment moves here, the
                // board's own `Head` wrapper is deleted, and a head that carries an `InfoTip`
                // caption re-normalises the case around it (`standings-table.tsx`).
                className={`${columnClass(column)}${CELL_PADDING_CLASS} align-top ${MICRO_LABEL} font-normal text-text-faint`}
              >
                {isJudged(column) ? <JudgedHead column={column} /> : column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} style={rowHeightStyle} className={`border-b border-line/50 ${rowClassName?.(row) ?? ""}`} {...rowAttributes?.(row)}>
              {columns.map((column) => (
                <td key={column.key} className={`${columnClass(column)}${CELL_PADDING_CLASS}`}>
                  {isJudged(column) ? judgedCell(column, row, populations.get(column.key) ?? []) : column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
