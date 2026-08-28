import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { PlayerRow } from "./player-row";
import { Button } from "./button";
import { Stat } from "./stat";
import type { Player } from "@/domain/player";

const CROFT: Player = { id: "rb1", name: "Jalen Croft", position: "RB", nflTeam: "IND", headshotUrl: null, adp: 1.6 };

/** The longest real name in the league, which is what actually breaks a 360px row. */
const LONG: Player = { ...CROFT, id: "wr1", name: "Amon-Ra St. Brown Jr.", position: "WR", nflTeam: "DET" };

describe("PlayerRow", () => {
  it("draws the player as an object — face, club colour, position, name — and is axe-clean in both themes", async () => {
    // Law 3, minus the jersey number the domain `Player` does not carry (see `PlayerFace`'s own
    // docblock for why inventing one would be worse than the gap).
    await renderSurface(<PlayerRow player={CROFT} meta="IND · Bye 13 · RB4" />, async ({ container }) => {
      expect(screen.getByText("Jalen Croft")).toBeInTheDocument();
      expect(screen.getByText("RB")).toBeInTheDocument();
      expect(screen.getByText("IND · Bye 13 · RB4")).toBeInTheDocument();
      expect(screen.getByTestId("player-face-team")).toHaveAttribute("data-team", "IND");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("renders the meta line as mono, quiet, small — it is data, not prose", () => {
    render(<PlayerRow player={CROFT} meta="IND · Bye 13 · RB4" />);
    const line = screen.getByText("IND · Bye 13 · RB4").parentElement!;
    expect(line.className).toContain("font-mono");
    expect(line.className).toContain("text-text-muted");
    expect(line.className).toContain("text-xs");
  });

  /**
   * LAW 5, THE VERB IS OBVIOUS. The row carries the action as a SLOT, so one atom serves "Draft"
   * in a snake room, "Nominate" in an auction and nothing at all on a board you are only reading.
   * A row that built its own button would have to learn every room's rules about when a manager
   * may act, which is server truth.
   */
  it("hands the verb through untouched, and stays out of its way", async () => {
    const onAct = vi.fn();
    await renderSurface(
      <PlayerRow player={CROFT} meta="IND · Bye 13" action={<Button variant="verb" onClick={onAct}>Draft</Button>} />,
      async ({ container }) => {
        const button = screen.getByRole("button", { name: "Draft" });
        fireEvent.click(button);
        expect(await axe(container)).toHaveNoViolations();
      },
    );
    expect(onAct).toHaveBeenCalled();
  });

  it("is never itself a control, so a board has exactly one way to draft a man", () => {
    const { container } = render(<PlayerRow player={CROFT} action={<Button variant="verb">Draft</Button>} />);
    const row = container.firstElementChild!;
    expect(row.tagName).toBe("DIV");
    expect(row).not.toHaveAttribute("role");
    expect(row).not.toHaveAttribute("tabindex");
    expect(row).not.toHaveAttribute("onclick");
  });

  it("carries a verdict without ever naming a magnitude colour itself", async () => {
    // `Stat` is the only file allowed to spell `text-mag-*` (`magnitude-budget.source.test.ts`),
    // and that budget is what keeps green meaning "press this" everywhere else. So the verdict is
    // a slot, and this proves the slot renders a real one.
    await renderSurface(
      <PlayerRow
        player={CROFT}
        verdict={<Stat label="steal" value="+11" size="sm" orientation="inline" comparison={{ percentile: 0.92, population: "running backs" }} />}
      />,
      async ({ container }) => {
        expect(screen.getByText("+11")).toBeInTheDocument();
        expect(container.innerHTML).toContain("text-mag-strong");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  /**
   * THE TOP-OF-BOARD SKIN. `bg-accent/10` is unavailable by design — `accent-budget.source.test.ts`
   * bans the `bg-accent` substring outside its allowlist, tints included — so the wash is a named
   * `globals.css` utility over the same per-theme `accentGlow` role the hero's `.floodlight` uses,
   * and the border is `accent` rather than `line`. Both halves are asserted because the wash alone
   * is a soft signal and the border alone is a hard one; the row wants the pair.
   */
  it("gives the top-of-board row an accent border and a wash, spelled as a whole skin", async () => {
    await renderSurface(<PlayerRow player={CROFT} meta="IND · Bye 13" highlight />, async ({ container }) => {
      const row = container.firstElementChild!;
      expect(row).toHaveAttribute("data-highlight", "true");
      expect(row.className).toContain("border-accent");
      expect(row.className).toContain("accent-wash");
      // The whole skin is chosen by name, so the two border colours never race each other in the
      // stylesheet the way a base-plus-override would.
      expect(row.className).not.toContain("border-line");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("is a quiet row by default — no wash, no accent, no marker attribute to leak into a selector", () => {
    const { container } = render(<PlayerRow player={CROFT} meta="IND · Bye 13" />);
    const row = container.firstElementChild!;
    expect(row).not.toHaveAttribute("data-highlight");
    expect(row.className).toContain("border-line");
    expect(row.className).not.toContain("accent-wash");
  });

  /**
   * 360px IS THE PRODUCT'S MINIMUM VIEWPORT (`TOKENS.minViewport`), and a flex child's automatic
   * minimum size is its CONTENT — so without `min-w-0` on the name column and `truncate` on the
   * name, one long name beside a verdict and a button pushes the row past the viewport and the
   * whole PAGE scrolls sideways. jsdom lays nothing out, so the contract is asserted as the two
   * classes that carry it rather than as a measured width.
   */
  it("truncates a long name inside a zero-minimum column, so a phone never scrolls sideways", () => {
    render(<PlayerRow player={LONG} meta="DET · Bye 5 · WR2" action={<Button variant="verb">Draft</Button>} />);
    const name = screen.getByText("Amon-Ra St. Brown Jr.");
    expect(name.className).toContain("truncate");
    const column = name.parentElement!;
    expect(column.className).toContain("min-w-0");
    expect(column.className).toContain("flex-1");
  });

  it("keeps the verdict and the verb at their own widths, so the name is the only column that gives", () => {
    render(<PlayerRow player={LONG} verdict={<span>+11</span>} action={<Button variant="verb">Draft</Button>} />);
    expect(screen.getByText("+11").parentElement!.className).toContain("shrink-0");
    expect(screen.getByRole("button", { name: "Draft" }).parentElement!.className).toContain("shrink-0");
  });

  it("omits the slots it was given nothing for, rather than reserving empty boxes in a dense list", () => {
    const { container } = render(<PlayerRow player={CROFT} />);
    // Face, then the name column. Nothing else — sixty rows of empty flex children is the
    // decorative whitespace law 4 exists to refuse.
    expect(container.firstElementChild!.children).toHaveLength(2);
  });

  it("lets the call site place the row without touching its skin", () => {
    const { container } = render(<PlayerRow player={CROFT} className="mb-1" />);
    expect(container.firstElementChild!.className).toContain("mb-1");
    expect(container.firstElementChild!.className).toContain("bg-surface-elevated");
  });
});
