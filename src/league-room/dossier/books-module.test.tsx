import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { PlayerFactsBooksNumbers } from "@research/capsules/facts";
import { BooksModule } from "./books-module";

const BOOKS: PlayerFactsBooksNumbers = {
  propsLines: [
    { market: "player_rush_yds", medianLine: 70.5 },
    { market: "player_receptions", medianLine: 3.5 },
  ],
  teamVegasWinTotal: 9.5,
};

describe("BooksModule", () => {
  it("phrases each props chip as its line, its English market name, and 'a game'", () => {
    const { container } = render(<BooksModule books={BOOKS} />);
    expect(container.textContent).toContain("70.5 rush yards a game");
    expect(container.textContent).toContain("3.5 receptions a game");
  });

  it("states the team's own Vegas win total", () => {
    const { container } = render(<BooksModule books={BOOKS} />);
    expect(container.textContent).toContain("Team win total: 9.5 wins.");
  });

  it("writes a book's number the way a book writes it: the half survives, a whole number grows no decimal", () => {
    const { container } = render(
      <BooksModule
        books={{
          propsLines: [{ market: "player_rush_yds", medianLine: 70.50000000000001 }],
          teamVegasWinTotal: 10,
        }}
      />,
    );
    expect(container.textContent).toContain("70.5 rush yards a game");
    expect(container.textContent).toContain("Team win total: 10 wins.");
    expect(container.textContent).not.toContain("10.0");
  });

  it("says an honest 'not posted yet' when the archive holds no win total", () => {
    const { container } = render(<BooksModule books={{ ...BOOKS, teamVegasWinTotal: null }} />);
    expect(container.textContent).toContain("Team win total: not posted yet.");
  });

  it("says an honest sentence, never a bare empty chip row, when no props line exists at all", () => {
    const { container } = render(<BooksModule books={{ propsLines: [], teamVegasWinTotal: null }} />);
    expect(container.textContent).toContain("No props line posted for him yet.");
    expect(container.querySelectorAll("[data-books-chip]")).toHaveLength(0);
  });

  it("renders nothing at all for the ADP sparkline in this task", () => {
    const { container } = render(<BooksModule books={BOOKS} />);
    expect(container.textContent).not.toMatch(/sparkline/i);
    expect(container.textContent).not.toMatch(/adp/i);
  });

  it("follows the copy rules — no em-dash, no semicolon", () => {
    const { container } = render(<BooksModule books={BOOKS} />);
    expect(container.textContent).not.toMatch(/—/);
    expect(container.textContent).not.toMatch(/;/);
  });

  it("renders axe-clean in both themes", async () => {
    await renderSurface(<BooksModule books={BOOKS} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
