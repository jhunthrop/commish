import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { PlayerRow } from "./player-row";
import { Button } from "./button";
import { Stat } from "./stat";
import type { Player } from "@research-ts/domain/player";

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

  it("renders the name largest, in the display face at 700, and the meta line small and quiet under it (P1)", () => {
    render(<PlayerRow player={CROFT} meta="IND · Bye 13 · RB4" />);
    const name = screen.getByText("Jalen Croft");
    expect(name.className).toContain("font-display");
    expect(name.className).toContain("text-lg");
    expect(name.className).toContain("font-bold");
    const line = screen.getByText("IND · Bye 13 · RB4").parentElement!;
    expect(line.className).toContain("text-text-muted");
    expect(line.className).toContain("text-sm");
  });

  it("is a 48px row on a 12px plate: Sideline's density, spelled once in the shell", () => {
    const { container } = render(<PlayerRow player={CROFT} />);
    expect(container.firstElementChild!.className).toContain("min-h-12");
    expect(container.firstElementChild!.className).toContain("rounded-md");
    expect(container.firstElementChild!.className).not.toContain("border");
  });

  it("carries the one number at its right, before the control (P2)", () => {
    const { container } = render(<PlayerRow player={CROFT} figure={<span>20.2</span>} action={<Button variant="verb">Draft</Button>} />);
    const children = Array.from(container.firstElementChild!.children);
    const figureIndex = children.findIndex((child) => child.textContent === "20.2");
    const actionIndex = children.findIndex((child) => child.textContent === "Draft");
    expect(figureIndex).toBe(2);
    expect(actionIndex).toBe(3);
    expect(children[figureIndex]!.className).toContain("shrink-0");
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
   * `globals.css` utility over the per-theme `accentGlow` role, and the border is `accent` rather
   * than `line`. Both halves are asserted because the wash alone
   * is a soft signal and the border alone is a hard one; the row wants the pair.
   */
  it("gives the highlighted row the amber wash (yours, never the verb's blue), spelled as a whole skin, with no border", async () => {
    await renderSurface(<PlayerRow player={CROFT} meta="IND · Bye 13" highlight />, async ({ container }) => {
      const row = container.firstElementChild!;
      expect(row).toHaveAttribute("data-highlight", "true");
      expect(row.className).toContain("self-wash");
      expect(row.className).not.toContain("accent-wash");
      expect(row.className).not.toContain("border");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("is a quiet row by default, with a chalk hover plate and no marker attribute to leak into a selector", () => {
    const { container } = render(<PlayerRow player={CROFT} meta="IND · Bye 13" />);
    const row = container.firstElementChild!;
    expect(row).not.toHaveAttribute("data-highlight");
    expect(row.className).toContain("hover:bg-surface");
    expect(row.className).not.toContain("self-wash");
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

  it("takes a pressable name through the name slot, inside the row's own name span, in both themes", async () => {
    const onOpen = vi.fn();
    await renderSurface(
      <PlayerRow
        player={CROFT}
        name={
          <button type="button" onClick={onOpen}>
            Jalen Croft
          </button>
        }
      />,
      async ({ container }) => {
        const name = screen.getByRole("button", { name: "Jalen Croft" });
        expect(screen.getByTestId("pool-player-name")).toContainElement(name);
        expect(screen.getByTestId("pool-player-name").className).toContain("font-display");
        fireEvent.click(name);
        expect(await axe(container)).toHaveNoViolations();
      },
    );
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("lets the call site place the row without touching its skin", () => {
    const { container } = render(<PlayerRow player={CROFT} className="mb-1" />);
    expect(container.firstElementChild!.className).toContain("mb-1");
    expect(container.firstElementChild!.className).toContain("rounded-md");
  });
  /**
   * THE RESEARCH DENSITY (Sideline research round) — the draft board, the pool, a game log go to
   * 44px "with a face still present", which is the half of the ruling a dense row is most likely to
   * lose. The height is chosen inside the shell rather than appended by the caller: two `min-h-*`
   * utilities in one class string resolve in Tailwind's order, not the caller's.
   */
  it("goes to 44px with a smaller face and never two heights at once", () => {
    const { container } = render(<PlayerRow player={CROFT} dense />);
    const row = container.firstElementChild!;
    expect(row.className).toContain("min-h-11");
    expect(row.className).not.toContain("min-h-12");
    expect(screen.getByTestId("player-face-team").className).toContain("size-8");
  });

  it("keeps the 48px row and its 36px face by default", () => {
    const { container } = render(<PlayerRow player={CROFT} />);
    expect(container.firstElementChild!.className).toContain("min-h-12");
    expect(screen.getByTestId("player-face-team").className).toContain("size-9");
  });

  /** P1 rules out a row that begins with a rank numeral in DISPLAY type. The ordinal is body size
   *  in the quiet ink, and the face is still the first thing the eye lands on. */
  it("prints a ranked list's ordinal before the face, quiet and never in the display face", () => {
    const { container } = render(<PlayerRow player={CROFT} lead={4} />);
    const lead = container.firstElementChild!.firstElementChild!;
    expect(lead.textContent).toBe("4");
    expect(lead.className).toContain("text-text-faint");
    expect(lead.className).not.toContain("font-display");
    expect(lead.className).toContain("tabular-nums");
  });
});
