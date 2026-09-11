import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Table, type TableColumn } from "./table";
import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { renderSurface } from "./test-utils";
import { UI_CONFIG } from "./config";
import { TOKENS } from "@/design/tokens";

interface Pick {
  readonly id: string;
  readonly player: string;
  readonly team: string;
  readonly price: number;
}

const rows: readonly Pick[] = [
  { id: "1", player: "Jalen Croft", team: "Bay Bandits", price: 42 },
  { id: "2", player: "Marcus Reed", team: "Iron Owls", price: 17 },
];

const columns: readonly TableColumn<Pick>[] = [
  { key: "player", header: "Player", cell: (r) => r.player },
  { key: "team", header: "Team", cell: (r) => r.team, hideOnNarrow: true },
  { key: "price", header: "Price", cell: (r) => `$${r.price}`, numeric: true },
];

describe("Table", () => {
  it("is a captioned, header-scoped table in both themes with no axe violations", async () => {
    await renderSurface(
      <Table caption="Auction results" columns={columns} rows={rows} rowKey={(r) => r.id} empty={<p>No picks yet.</p>} />,
      async ({ container }) => {
        const table = screen.getByRole("table", { name: "Auction results" });
        expect(within(table).getByRole("columnheader", { name: "Player" })).toHaveAttribute("scope", "col");
        expect(within(table).getAllByRole("row")).toHaveLength(rows.length + 1);
        expect(within(table).getByText("$42")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("hides the caption visually but keeps it as the accessible name by default", () => {
    render(<Table caption="Auction results" columns={columns} rows={rows} rowKey={(r) => r.id} empty={<p>None.</p>} />);
    expect(screen.getByText("Auction results")).toHaveClass("sr-only");
  });

  it("shows the caption when asked", () => {
    render(<Table caption="Auction results" captionVisible columns={columns} rows={rows} rowKey={(r) => r.id} empty={<p>None.</p>} />);
    expect(screen.getByText("Auction results")).not.toHaveClass("sr-only");
  });

  it("renders only the empty node — no header row — and is axe-clean in both themes when there are no rows", async () => {
    await renderSurface(
      <Table
        caption="Auction results"
        columns={columns}
        rows={[]}
        rowKey={(r: Pick) => r.id}
        empty={<EmptyState title="No picks yet" description="Picks land here as they happen." action={<Button>Refresh</Button>} />}
      />,
      async ({ container }) => {
        expect(screen.queryByRole("table")).toBeNull();
        expect(screen.getByRole("heading", { name: "No picks yet" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("applies per-row styling and marks numeric and narrow-hidden columns", () => {
    render(
      <Table
        caption="Auction results"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        rowClassName={(r) => (r.id === "1" ? "is-mine" : "")}
        empty={<p>None.</p>}
      />,
    );
    expect(screen.getByText("Jalen Croft").closest("tr")).toHaveClass("is-mine");
    expect(screen.getByText("$42")).toHaveClass("text-right");
    expect(screen.getByRole("columnheader", { name: "Team" }).className).toMatch(/hidden/);
  });

  // A ROW'S HEIGHT IS A TOKEN (Sideline, 2026-09-10). The table used to set a vertical PADDING,
  // which made its real row height content plus a constant and put that constant in `UI_CONFIG`
  // rather than in the token file everything else's rhythm comes from. Both heights now come from
  // `TOKENS.density`, and these two assertions read them from there rather than restating them: a
  // test that pins a spacing VALUE is testing the token, while what earns its keep is that the
  // height reaches the DOM as an inline style at all (a templated `h-[Npx]` class ships no rule).
  it("stands a dense row at the density token's own dense height, by default", () => {
    render(<Table caption="Auction results" columns={columns} rows={rows} rowKey={(r) => r.id} empty={<p>None.</p>} />);
    const row = screen.getByText("Jalen Croft").closest("tr")!;
    expect(row).toHaveStyle({ height: `${TOKENS.density.denseRowPx}px` });
  });

  it("stands a comfortable row at the density token's own row height", () => {
    render(
      <Table caption="Auction results" columns={columns} rows={rows} rowKey={(r) => r.id} empty={<p>None.</p>} density="comfortable" />,
    );
    const row = screen.getByText("Jalen Croft").closest("tr")!;
    expect(row).toHaveStyle({ height: `${TOKENS.density.rowPx}px` });
  });

  it("spreads rowAttributes directly onto the row, not a second wrapper element", () => {
    render(
      <Table
        caption="Auction results"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        rowAttributes={(r) => ({ "data-own": r.id === "1" ? "true" : "false" })}
        empty={<p>None.</p>}
      />,
    );
    const ownRow = screen.getByText("Jalen Croft").closest("tr");
    expect(ownRow).toHaveAttribute("data-own", "true");
    expect(ownRow?.tagName).toBe("TR");
    expect(screen.getByText("Marcus Reed").closest("tr")).toHaveAttribute("data-own", "false");
  });
});

/**
 * A JUDGED COLUMN, and the four promises rule 1's magnitude amendment attaches to a tint. Every
 * one of them is a thing that would be invisible in a screenshot and wrong in production, which is
 * why they are pinned here rather than eyeballed.
 */
describe("Table, judged columns", () => {
  const league: readonly Pick[] = [
    { id: "1", player: "Bay Bandits", team: "Ann", price: 143 },
    { id: "2", player: "Iron Owls", team: "Bo", price: 131 },
    { id: "3", player: "Dust Devils", team: "Cy", price: 120 },
    { id: "4", player: "Copper Coyotes", team: "Di", price: 102 },
  ];

  const judgedColumns: readonly TableColumn<Pick>[] = [
    { key: "player", header: "Team", cell: (r) => r.player },
    { key: "price", header: "Points for", judged: { value: (r) => r.price, format: (v) => v.toFixed(2), set: "the league" } },
  ];

  function priceCell(name: string): HTMLElement {
    return within(screen.getByText(name).closest("tr")!).getByText(/\d+\.\d\d/);
  }

  it("ranks a column against itself, in both themes, with no axe violations", async () => {
    await renderSurface(
      <Table caption="League standings" columns={judgedColumns} rows={league} rowKey={(r) => r.id} empty={<p>None.</p>} />,
      async ({ container }) => {
        // The best and the worst number in the column land at opposite ends of the ramp, and the
        // two in the middle do not — a heat map that tints every cell has said nothing four times.
        expect(priceCell("Bay Bandits").closest("[data-magnitude]")).toHaveAttribute("data-magnitude", "strong");
        expect(priceCell("Copper Coyotes").closest("[data-magnitude]")).toHaveAttribute("data-magnitude", "bad");
        expect(priceCell("Iron Owls").closest("[data-magnitude]")).toHaveAttribute("data-magnitude", "neutral");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("states the comparison set in the column head rather than leaving a reader to infer it", () => {
    render(<Table caption="League standings" columns={judgedColumns} rows={league} rowKey={(r) => r.id} empty={<p>None.</p>} />);
    expect(screen.getByRole("columnheader", { name: /Points for/ })).toHaveTextContent("vs the league");
  });

  it("says which way the ramp runs for a column whose biggest number is its worst", () => {
    const against: readonly TableColumn<Pick>[] = [
      { key: "player", header: "Team", cell: (r) => r.player },
      {
        key: "price",
        header: "Points against",
        judged: { value: (r) => r.price, format: (v) => v.toFixed(2), set: "the league", direction: "lower-is-better" },
      },
    ];
    render(<Table caption="League standings" columns={against} rows={league} rowKey={(r) => r.id} empty={<p>None.</p>} />);
    expect(screen.getByRole("columnheader", { name: /Points against/ })).toHaveTextContent("vs the league, lower is better");
    // The ramp inverted with the direction: the biggest number is now the worst one.
    expect(priceCell("Bay Bandits").closest("[data-magnitude]")).toHaveAttribute("data-magnitude", "bad");
    expect(priceCell("Copper Coyotes").closest("[data-magnitude]")).toHaveAttribute("data-magnitude", "strong");
  });

  it("refuses to tint a set too small to be a population, and renders plain ink instead", () => {
    // Three teams is not a league, it is three teams, and a percentile across them is arithmetic
    // dressed as a fact. `UI_CONFIG.stat.minPopulation` is the floor; below it every cell is
    // `neutral`, which is `textPrimary` verbatim.
    render(
      <Table
        caption="League standings"
        columns={judgedColumns}
        rows={league.slice(0, UI_CONFIG.stat.minPopulation - 1)}
        rowKey={(r) => r.id}
        empty={<p>None.</p>}
      />,
    );
    for (const name of ["Bay Bandits", "Iron Owls", "Dust Devils"]) {
      expect(priceCell(name).closest("[data-magnitude]")).toHaveAttribute("data-magnitude", "neutral");
    }
  });

  it("never lets colour travel alone: a judged value keeps its caret and its weight step", () => {
    // Green versus red is the worst available pair for deuteranopia and this audience is
    // overwhelmingly men. Strip the hue and the column must still rank, which is what the caret
    // and the weight are for — the reason the table path goes through `Stat` rather than through
    // an allowlist entry of its own (`magnitude-budget.source.test.ts`).
    render(<Table caption="League standings" columns={judgedColumns} rows={league} rowKey={(r) => r.id} empty={<p>None.</p>} />);
    const best = priceCell("Bay Bandits").parentElement!;
    expect(best.className).toMatch(/font-semibold/);
    expect(best).toHaveTextContent("▲");
    const worst = priceCell("Copper Coyotes").parentElement!;
    expect(worst).toHaveTextContent("▼");
    // The middle of the column carries no caret at all — nothing to say is said with nothing.
    expect(priceCell("Iron Owls").parentElement!).not.toHaveTextContent("▲");
  });

  it("leaves a row with no number out of the population instead of folding it to a zero", () => {
    // "Has not played" and "played and scored nothing" are different facts. A zero in the pool
    // would drag every real number up the ramp on a Sunday morning.
    const withAbsence: readonly TableColumn<Pick>[] = [
      { key: "player", header: "Team", cell: (r) => r.player },
      {
        key: "price",
        header: "Points for",
        judged: { value: (r) => (r.id === "4" ? null : r.price), format: (v) => v.toFixed(2), set: "the league" },
      },
    ];
    render(<Table caption="League standings" columns={withAbsence} rows={league} rowKey={(r) => r.id} empty={<p>None.</p>} />);
    expect(within(screen.getByText("Copper Coyotes").closest("tr")!).getByText("—")).toBeInTheDocument();
    // Three real numbers left, which is below the floor, so the survivors are plain ink too.
    expect(priceCell("Bay Bandits").closest("[data-magnitude]")).toHaveAttribute("data-magnitude", "neutral");
  });

  it("labels every judged cell from its own column head, once, for assistive tech only", () => {
    render(<Table caption="League standings" columns={judgedColumns} rows={league} rowKey={(r) => r.id} empty={<p>None.</p>} />);
    // Four rows, four announced labels, none of them printed under a figure.
    const labels = screen.getAllByText("Points for", { selector: ".sr-only" });
    expect(labels).toHaveLength(league.length);
  });
});
