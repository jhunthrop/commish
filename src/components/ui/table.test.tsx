import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Table, type TableColumn } from "./table";
import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { inBothThemes } from "./test-utils";

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
    await inBothThemes(
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
    await inBothThemes(
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
});
