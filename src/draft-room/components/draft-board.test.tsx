import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { REDUCED_MOTION_QUERY } from "@/design/use-reduced-motion";
import { renderSurface } from "@/components/ui/test-utils";
import { blendOver, contrastRatio } from "@/design/test-support";
import { TOKENS } from "@/design/tokens";
import { AUCTION_VIEW, PLAYERS, SNAKE_VIEW, TEAMS, TEAMS_WITH_BOT, playersById } from "../test-fixtures";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import { DraftBoard } from "./draft-board";

function stubMatchMedia(reduced: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === REDUCED_MOTION_QUERY ? reduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function pick(over: Partial<CompletedPick> = {}): CompletedPick {
  return {
    pickNumber: 1,
    round: 1,
    teamId: "t1",
    playerId: "qb1",
    slot: "QB",
    slotIndex: 0,
    price: null,
    timestamp: "2026-09-01T00:05:00.000Z",
    auto: false,
    ...over,
  };
}

/** Round 1 ran t1 → t2; round 2 turns around and runs t2 → t1. */
const SERPENTINE: readonly CompletedPick[] = [
  pick({ pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1", slot: "QB" }),
  pick({ pickNumber: 2, round: 1, teamId: "t2", playerId: "rb1", slot: "RB" }),
  pick({ pickNumber: 3, round: 2, teamId: "t2", playerId: "rb2", slot: "RB" }),
  pick({ pickNumber: 4, round: 2, teamId: "t1", playerId: "wr1", slot: "RB" }),
];

const props = {
  teams: TEAMS,
  playersById: playersById(PLAYERS),
  myTeamId: "t1",
};

function grid(): HTMLElement {
  return screen.getByTestId("draft-board-grid");
}

describe("DraftBoard", () => {
  it("draws a column per team and a row per roster spot, axe-clean in both themes", async () => {
    stubMatchMedia(false);
    await renderSurface(<DraftBoard {...props} view={SNAKE_VIEW} />, async ({ container }) => {
      const table = within(grid()).getByRole("table", { name: /draft board/i });
      // Header row plus one row per roster spot (SNAKE_VIEW declares QB×1 + RB×2).
      expect(within(table).getAllByRole("row")).toHaveLength(1 + 3);
      expect(within(table).getByRole("columnheader", { name: /Bay Bandits/ })).toBeInTheDocument();
      expect(within(table).getByRole("columnheader", { name: /Iron Owls/ })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // E4 (2026-08-26 design review): at 1440px with chat open, the room variant's own
  // `min-w-32`/`xl:min-w-40` stickers left only ~4.3 of 12 columns on screen — the on-clock
  // cell and the manager's own column were routinely off-viewport. A denser floor BELOW `lg`
  // (a laptop's own belt, where "wide" is not yet desktop-wide) buys back columns without
  // touching the `lg`/`xl` sizes a wider monitor already had right.
  it("gives the room variant a denser sticker floor below lg, unchanged at lg and xl (E4)", () => {
    stubMatchMedia(false);
    render(<DraftBoard {...props} view={SNAKE_VIEW} />);
    const header = within(grid()).getByRole("columnheader", { name: /Bay Bandits/ });
    expect(header.className).toContain("min-w-28");
    expect(header.className).toContain("lg:min-w-32");
    expect(header.className).toContain("xl:min-w-40");
  });

  it("puts each pick in its own team's column and round's row, as a position-colored sticker", () => {
    stubMatchMedia(false);
    render(<DraftBoard {...props} view={{ ...SNAKE_VIEW, picks: SERPENTINE }} />);
    const rows = within(grid()).getAllByRole("row");
    // rows[0] is the header; rows[1] is round 1.
    const roundOne = within(rows[1]!).getAllByRole("cell");
    expect(roundOne[0]).toHaveTextContent("Jalen Croft");
    expect(roundOne[0]).toHaveTextContent("QB · KC");
    expect(roundOne[1]).toHaveTextContent("Marcus Reed");
    expect(roundOne[0]!.querySelector(".bg-pos-qb")).not.toBeNull();
    expect(roundOne[1]!.querySelector(".bg-pos-rb")).not.toBeNull();
  });

  it("marks the team on the clock with a spotlight cell, in their next empty round", () => {
    stubMatchMedia(false);
    const view: DraftStateView = { ...SNAKE_VIEW, picks: SERPENTINE, onClockTeamId: "t1", pickNumber: 5 };
    render(<DraftBoard {...props} view={view} />);
    const rows = within(grid()).getAllByRole("row");
    // t1 owns rounds 1 and 2, so their spotlight is round 3 — rows[3].
    const roundThree = within(rows[3]!).getAllByRole("cell");
    expect(roundThree[0]).toHaveTextContent("On the clock");
    expect(roundThree[1]).not.toHaveTextContent("On the clock");
    expect(roundThree[0]!.querySelector(".animate-spotlight")).not.toBeNull();
  });

  it("holds the spotlight ring still when the user prefers reduced motion", () => {
    stubMatchMedia(true);
    const view: DraftStateView = { ...SNAKE_VIEW, picks: SERPENTINE, onClockTeamId: "t1" };
    const { container } = render(<DraftBoard {...props} view={view} />);
    expect(container.querySelector(".ring-negative")).not.toBeNull();
    expect(container.querySelector(".animate-spotlight")).toBeNull();
  });

  // E1 (2026-08-26 design review): one fact, one color family. The rail says "You're on the
  // clock" in live-red while this cell answered in money-green — rule 1 assigns clocks and
  // live to red, and the split was loudest at the emotional peak. The cell (ring + label +
  // spotlight breath) joins the negative family. The decision the review asked for, made
  // once: the "You" COLUMN marker stays money — it names identity (your own column, the same
  // meaning as the my-row tint), never the clock.
  it("speaks the on-clock fact in the clock's own red family, never money-green (E1)", () => {
    stubMatchMedia(false);
    const view: DraftStateView = { ...SNAKE_VIEW, picks: SERPENTINE, onClockTeamId: "t1", pickNumber: 5 };
    const { container } = render(<DraftBoard {...props} view={view} />);
    const cell = container.querySelector('[data-onclock-cell="true"]')!;
    expect(cell.querySelector(".ring-negative")).not.toBeNull();
    expect(cell.querySelector(".ring-accent")).toBeNull();
    expect(within(cell as HTMLElement).getByText("On the clock").className).toContain("text-negative");
    // Identity stays money: my own column header keeps its accent marker.
    const myHeader = within(grid()).getByRole("columnheader", { name: /Bay Bandits/ });
    expect(myHeader.className).toContain("ring-accent");
    expect(within(myHeader).getByText("You").className).toContain("text-accent");
  });

  it("slaps only the sticker for the pick that just landed", () => {
    stubMatchMedia(false);
    const { container } = render(<DraftBoard {...props} view={{ ...SNAKE_VIEW, picks: SERPENTINE }} landedPickNumber={4} />);
    const slapped = container.querySelectorAll(".animate-sticker-slap");
    // One in the wide grid, one in the narrow list — the same cell, rendered for two widths.
    expect(slapped.length).toBeGreaterThan(0);
    for (const node of slapped) expect(node.textContent).toContain("Andre Salas");
  });

  it("never animates a landing when the user prefers reduced motion — the sticker just appears", () => {
    stubMatchMedia(true);
    const { container } = render(<DraftBoard {...props} view={{ ...SNAKE_VIEW, picks: SERPENTINE }} landedPickNumber={4} />);
    expect(container.querySelector(".animate-sticker-slap")).toBeNull();
    expect(screen.getAllByText("Andre Salas").length).toBeGreaterThan(0);
  });

  it("shows which way a snake round actually ran, read off the picks in it", () => {
    stubMatchMedia(false);
    render(<DraftBoard {...props} view={{ ...SNAKE_VIEW, picks: SERPENTINE }} />);
    const rows = within(grid()).getAllByRole("row");
    expect(within(rows[1]!).getByRole("rowheader")).toHaveTextContent("picked left to right");
    expect(within(rows[2]!).getByRole("rowheader")).toHaveTextContent("picked right to left");
    // Round 3 has no picks, so there is nothing to report and no arrow is invented.
    expect(within(rows[3]!).getByRole("rowheader")).not.toHaveTextContent("picked");
  });

  it("claims no direction for an auction, where a round is not an order", () => {
    stubMatchMedia(false);
    const view: DraftStateView = { ...AUCTION_VIEW, picks: SERPENTINE };
    render(<DraftBoard {...props} view={view} />);
    for (const row of within(grid()).getAllByRole("row").slice(1)) {
      expect(within(row).getByRole("rowheader")).not.toHaveTextContent("picked");
    }
  });

  it("marks your own column so you can find yourself at a glance", () => {
    stubMatchMedia(false);
    render(<DraftBoard {...props} view={SNAKE_VIEW} />);
    expect(within(grid()).getByRole("columnheader", { name: /Bay Bandits/ })).toHaveTextContent("You");
    expect(within(grid()).getByRole("columnheader", { name: /Iron Owls/ })).not.toHaveTextContent("You");
  });

  it("collapses to a per-round list, newest round first, for the 360px layout", () => {
    stubMatchMedia(false);
    render(<DraftBoard {...props} view={{ ...SNAKE_VIEW, picks: SERPENTINE }} />);
    const list = screen.getByTestId("draft-board-list");
    // The round in progress leads, then the completed rounds newest-first. Rounds nobody has
    // reached yet are left off — a phone screen of empty slots is a scroll, not information.
    expect(within(list).getAllByRole("heading").map((heading) => heading.textContent)).toEqual(["Round 3", "Round 2", "Round 1"]);
    expect(within(list).getByText("On the clock")).toBeInTheDocument();
  });

  it("says so plainly in the narrow list when nothing has been drafted yet", () => {
    stubMatchMedia(false);
    render(<DraftBoard {...props} view={{ ...SNAKE_VIEW, phase: "scheduled", onClockTeamId: null }} />);
    expect(within(screen.getByTestId("draft-board-list")).getByText(/Nothing has been drafted yet/)).toBeInTheDocument();
  });

  it("still draws a column per team before the draft order exists", () => {
    stubMatchMedia(false);
    const view: DraftStateView = { ...SNAKE_VIEW, phase: "scheduled", draftOrder: [], picks: [], onClockTeamId: null };
    render(<DraftBoard {...props} view={view} />);
    expect(within(grid()).getByRole("columnheader", { name: /Bay Bandits/ })).toBeInTheDocument();
    expect(within(grid()).getByRole("columnheader", { name: /Iron Owls/ })).toBeInTheDocument();
  });

  it("shows the winning price on an auction sticker", () => {
    stubMatchMedia(false);
    const view: DraftStateView = { ...AUCTION_VIEW, picks: [pick({ price: 42 })] };
    render(<DraftBoard {...props} view={view} />);
    expect(within(grid()).getAllByText(/\$42/).length).toBeGreaterThan(0);
  });

  it("reads bigger on the TV without saying anything different", () => {
    stubMatchMedia(false);
    render(<DraftBoard {...props} view={{ ...SNAKE_VIEW, picks: SERPENTINE }} variant="tv" />);
    const sticker = within(grid()).getAllByText("Jalen Croft")[0]!;
    expect(sticker.className).toContain("text-display-md");
  });

  // Task 12 Step 3: "the one surface where `xs` never appears" — the board's own authored
  // labels (a sticker's position/team sub-line, the "Rd" header, the slot number, the "You"
  // mark, and the on-clock/pending cell labels), walked across a live board and an on-clock one.
  it("never drops its own labels to text-xs on the TV", () => {
    stubMatchMedia(false);
    const onClockView: DraftStateView = { ...SNAKE_VIEW, picks: SERPENTINE, onClockTeamId: "t1", pickNumber: 5 };
    render(<DraftBoard {...props} view={onClockView} variant="tv" />);
    expect(within(grid()).getByText("QB · KC").className).not.toMatch(/(^|\s)text-xs(\s|$)/);
    expect(within(grid()).getByText("Rd").className).not.toMatch(/(^|\s)text-xs(\s|$)/);
    const myColumnHeader = within(grid()).getByRole("columnheader", { name: /Bay Bandits/ });
    expect(within(myColumnHeader).getByText("1").className).not.toMatch(/(^|\s)text-xs(\s|$)/);
    expect(within(myColumnHeader).getByText("You").className).not.toMatch(/(^|\s)text-xs(\s|$)/);
    expect(within(grid()).getByText("On the clock").className).not.toMatch(/(^|\s)text-xs(\s|$)/);
  });

  // Fix round 1 (F3): a skipped pick used to fall through to the same bare dashed `<div>` as a
  // round nobody has reached yet — indistinguishable in an otherwise-filled round, which is
  // exactly where it is most confusing. `SKIPPED_SERPENTINE` mirrors `SERPENTINE` with t2's own
  // round-1 pick (pick 2) never made — owed instead of drafted, `owedPicks: { t2: [2] }`.
  describe("a skipped pick's own cell (Task 5)", () => {
    const SKIPPED_SERPENTINE: readonly CompletedPick[] = [
      pick({ pickNumber: 1, round: 1, teamId: "t1", playerId: "qb1", slot: "QB" }),
      // pick 2 (t2, round 1) is owed, not drafted — see `owedPicks` below.
      pick({ pickNumber: 3, round: 2, teamId: "t2", playerId: "rb2", slot: "RB" }),
      pick({ pickNumber: 4, round: 2, teamId: "t1", playerId: "wr1", slot: "RB" }),
    ];
    const view: DraftStateView = { ...SNAKE_VIEW, picks: SKIPPED_SERPENTINE, owedPicks: { t2: [2] } };

    it("labels it Pending in the wide grid, both themes, axe-clean — never a blank dashed box", async () => {
      stubMatchMedia(false);
      await renderSurface(<DraftBoard {...props} view={view} />, async ({ container }) => {
        const rows = within(grid()).getAllByRole("row");
        const roundOne = within(rows[1]!).getAllByRole("cell");
        expect(roundOne[1]).toHaveTextContent("Pending"); // t2's own column
        expect(roundOne[1]!.querySelector('[data-pending-cell="true"]')).not.toBeNull();
        // t1's real round-1 pick, and t2's real round-2 pick, are unaffected — a landed pick
        // renders as its own sticker, never as "Pending".
        expect(roundOne[0]).not.toHaveTextContent("Pending");
        expect(await axe(container)).toHaveNoViolations();
      });
    });

    it("names no one — the round already shows whose turn it is, elsewhere on the board", () => {
      stubMatchMedia(false);
      render(<DraftBoard {...props} view={view} />);
      const rows = within(grid()).getAllByRole("row");
      const pendingCell = within(rows[1]!).getAllByRole("cell")[1]!;
      expect(pendingCell).not.toHaveTextContent("Iron Owls"); // t2's own team name
      expect(pendingCell).not.toHaveTextContent(/missed|failed/i);
    });

    it("shows the pending cell in the narrow, 360px list too, not just the wide grid", () => {
      stubMatchMedia(false);
      render(<DraftBoard {...props} view={view} />);
      const list = screen.getByTestId("draft-board-list");
      const roundOneItem = within(list).getByRole("heading", { name: "Round 1" }).closest("li")!;
      expect(within(roundOneItem).getByText("Pending")).toBeInTheDocument();
    });

    it("shares the same Pending cell on the TV board's own board", () => {
      stubMatchMedia(false);
      render(<DraftBoard {...props} view={view} variant="tv" />);
      const rows = within(grid()).getAllByRole("row");
      expect(within(rows[1]!).getAllByRole("cell")[1]).toHaveTextContent("Pending");
    });
  });

  /**
   * Task 8, Step 1: every bot team card renders the practice marker, a human's never does, and
   * a real draft (`mock` omitted, its own default) renders no marker at all — the "byte-identical
   * for a real draft" requirement, proven here since `TeamCard.isBot` and `mock` are both new,
   * purely additive props with no existing consumer.
   */
  describe("the mock lane's bot marker", () => {
    const mock = { botMarkerLabel: "practice opponent", botBadge: "Bot" };

    it("marks a bot's own column with a quiet, ink-only chip, and never a human's — axe-clean, both themes", async () => {
      stubMatchMedia(false);
      await renderSurface(
        <DraftBoard {...props} teams={TEAMS_WITH_BOT} view={SNAKE_VIEW} mock={mock} />,
        async ({ container }) => {
          const botHeader = within(grid()).getByRole("columnheader", { name: /Turf Burners/ });
          expect(within(botHeader).getByText("Bot")).toBeInTheDocument();
          expect(within(botHeader).getByText(/practice opponent/)).toBeInTheDocument();
          const humanHeader = within(grid()).getByRole("columnheader", { name: /Bay Bandits/ });
          expect(within(humanHeader).queryByText("Bot")).not.toBeInTheDocument();
          expect(await axe(container)).toHaveNoViolations();
        },
      );
    });

    it("renders no marker at all for a real draft, where mock is never passed", () => {
      stubMatchMedia(false);
      render(<DraftBoard {...props} teams={TEAMS_WITH_BOT} view={SNAKE_VIEW} />);
      expect(screen.queryByText("Bot")).not.toBeInTheDocument();
      expect(screen.queryByText(/practice opponent/)).not.toBeInTheDocument();
    });
  });

  // Founder-reported live defect, 2026-08-25: a v2-era `border-line/35` opacity dilution on
  // far-future rounds' empty cells, once sunk into v3's `#0D0D0F` graphite ground, made rounds
  // 3-15 of a real board read as a void. The fix floors the recede at `border-line`'s own
  // decorative-hairline contrast against `surface` — a future cell may shrink, never dim past
  // that floor.
  describe("far-future rounds never dim their border past the line token's own floor", () => {
    const FIFTEEN_ROUND_VIEW: DraftStateView = {
      ...SNAKE_VIEW,
      slotConfig: [{ slot: "QB", count: 15, eligiblePositions: ["QB"] }],
      picks: [],
      onClockTeamId: "t1",
      pickNumber: 1,
    };

    it("never emits an opacity-diluted border-line class on any empty cell", () => {
      stubMatchMedia(false);
      render(<DraftBoard {...props} view={FIFTEEN_ROUND_VIEW} />);
      const emptyCells = within(grid()).getByRole("table").querySelectorAll('[aria-hidden="true"].border-dashed');
      expect(emptyCells.length).toBeGreaterThan(0);
      for (const cell of emptyCells) {
        // `border-line` is fine; `border-line/NN` (any opacity suffix) is exactly the v2-era
        // dilution this fix removes.
        expect(cell.className).not.toMatch(/border-line\//);
      }
    });

    it("renders the same border-line class, at full strength, for a near round and a far-future one", () => {
      stubMatchMedia(false);
      render(<DraftBoard {...props} view={FIFTEEN_ROUND_VIEW} />);
      const rows = within(grid()).getAllByRole("row");
      // Round 1 (rows[1]) is the active round — "near". Round 15 (rows[15]) is far past it.
      const nearCell = within(rows[1]!).getAllByRole("cell")[1]!.querySelector('[aria-hidden="true"]')!;
      const farCell = within(rows[15]!).getAllByRole("cell")[1]!.querySelector('[aria-hidden="true"]')!;
      expect(nearCell.className).toContain("border-line");
      expect(farCell.className).toContain("border-line");
      expect(nearCell.className).not.toMatch(/border-line\//);
      expect(farCell.className).not.toMatch(/border-line\//);
      // The two differ only by the height token that shapes the recede, never by color.
      expect(nearCell.className).toContain(DRAFT_ROOM_CONFIG.emptyCellBorderClass.near);
      expect(farCell.className).toContain(DRAFT_ROOM_CONFIG.emptyCellBorderClass.future);
    });

    it("would fail contrast if the old opacity dilution ever came back, in both themes", () => {
      // Quantifies why the fix floors at `border-line`'s own, undiluted contrast: any opacity
      // modifier composited toward `surface` (what a `border-line/NN` utility paints) can only
      // pull that number down, never up. The floored config never dilutes, so its contrast is
      // always the token pair's own — never the lower, diluted number a regression would produce.
      expect(DRAFT_ROOM_CONFIG.emptyCellBorderClass.future).not.toMatch(/border-line\//);
      for (const theme of ["light", "dark"] as const) {
        const { line, surface } = TOKENS.color[theme];
        const flooredContrast = contrastRatio(line, surface);
        const wouldBeDilutedColor = blendOver(line, 0.35, surface); // the old `border-line/35`
        const dilutedContrast = contrastRatio(wouldBeDilutedColor, surface);
        expect(flooredContrast).toBeGreaterThan(dilutedContrast);
      }
    });
  });

  /**
   * Founder live defect #2 (2026-08-25, ~2000px viewport): a scroll-edge fade painted over the
   * last visible pick column, tinting its colored sticker cells — "the shading... takes up a lot
   * of the screen." The fade was a static decorative overlay, always rendered regardless of
   * whether the grid actually had anything left to scroll to, pinned `z-20` above the sticker
   * cells themselves. Removed outright rather than made conditional: the grid's own native
   * scrollbar is the scroll affordance (the same convention `Table` already uses for its own
   * horizontal overflow, `docs/decisions/design-v2.md` §4), and a decorative box painted on top
   * of a sticker's own color is the "boxes" rule 4 (hairlines, not boxes) exists to rule out.
   */
  it("never paints a decorative gradient over the board's own scroll edges", () => {
    stubMatchMedia(false);
    const { container } = render(<DraftBoard {...props} view={{ ...SNAKE_VIEW, picks: SERPENTINE }} />);
    expect(container.querySelector(".bg-gradient-to-r")).toBeNull();
    expect(container.querySelector(".bg-gradient-to-l")).toBeNull();
  });

  // E7 (2026-08-26 design review): through the early-mid draft, most of a long board is bare
  // future rows — worse on the TV, where the void is bigger. The TV variant renders only the
  // active round plus `DRAFT_ROOM_CONFIG.tv.futureRoundsShown` beyond it, then one quiet summary
  // line for the rest; the room variant's own sliver recede (tested above) is untouched.
  describe("far-future rounds collapse into one line on the TV (E7)", () => {
    const TEN_ROUND_VIEW: DraftStateView = {
      ...SNAKE_VIEW,
      slotConfig: [{ slot: "QB", count: 10, eligiblePositions: ["QB"] }],
      picks: [],
      onClockTeamId: "t1",
      pickNumber: 1,
    };

    it("renders only the active round plus futureRoundsShown, then one summary line, on the TV", () => {
      stubMatchMedia(false);
      render(<DraftBoard {...props} view={TEN_ROUND_VIEW} variant="tv" />);
      const roundHeaders = within(grid())
        .getAllByRole("rowheader")
        .map((header) => header.textContent);
      // Active round 1, plus DRAFT_ROOM_CONFIG.tv.futureRoundsShown (2) more: rounds 1-3.
      expect(roundHeaders).toEqual(["1", "2", "3"]);
      const summary = within(grid()).getByText("7 rounds ahead");
      // The voice classes live on the td; the inner span is the sticky pin that keeps the
      // label inside the viewport while the board auto-scrolls (closing visual pass).
      expect(summary.className).toContain("sticky");
      const cell = summary.closest("td")!;
      expect(cell.className).toContain("font-mono");
      expect(cell.className).toContain("text-text-muted");
      expect(cell.className).toMatch(/border-t/);
    });

    it("renders every round on the room variant, with no summary line at all", () => {
      stubMatchMedia(false);
      render(<DraftBoard {...props} view={TEN_ROUND_VIEW} />);
      expect(within(grid()).getAllByRole("rowheader")).toHaveLength(10);
      expect(screen.queryByText(/rounds ahead/)).toBeNull();
    });

    it("says '1 round ahead' in the singular for exactly one collapsed round", () => {
      stubMatchMedia(false);
      const view: DraftStateView = { ...TEN_ROUND_VIEW, slotConfig: [{ slot: "QB", count: 4, eligiblePositions: ["QB"] }] };
      render(<DraftBoard {...props} view={view} variant="tv" />);
      expect(within(grid()).getByText("1 round ahead")).toBeInTheDocument();
    });

    it("shows no summary line at all when there is nothing left to collapse", () => {
      stubMatchMedia(false);
      const view: DraftStateView = { ...TEN_ROUND_VIEW, slotConfig: [{ slot: "QB", count: 3, eligiblePositions: ["QB"] }] };
      render(<DraftBoard {...props} view={view} variant="tv" />);
      expect(screen.queryByText(/rounds ahead/)).toBeNull();
    });
  });

  it("wears the player's own face on a drafted sticker, initials only as the fallback (founder directive)", () => {
    stubMatchMedia(false);
    render(<DraftBoard {...props} view={{ ...SNAKE_VIEW, picks: SERPENTINE }} />);
    // qb1's fixture carries a real headshot URL; the drafted sticker renders its image.
    const grid_ = grid();
    const faces = Array.from(grid_.querySelectorAll("img"));
    expect(faces.some((img) => (img.getAttribute("src") ?? "").includes("qb1.png"))).toBe(true);
  });
});
