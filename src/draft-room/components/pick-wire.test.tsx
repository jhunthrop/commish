import { describe, it, expect } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CompletedPick } from "@/draft-engine";
import { LeagueRoomDepsProvider } from "@/league-room/hooks/deps";
import { PlayerPeekHost } from "@/league-room/components/player-peek";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import { PLAYERS, TEAMS, SNAKE_VIEW, playersById } from "../test-fixtures";
import { PickWire } from "./pick-wire";

/** A minimal snake `CompletedPick` — every field this band never reads (`slot`, `slotIndex`,
 *  `timestamp`) gets a fixed filler so each test only varies what it's actually asserting on. */
function pick(overrides: Partial<CompletedPick> & Pick<CompletedPick, "pickNumber" | "teamId" | "playerId">): CompletedPick {
  return { round: 1, slot: "RB", slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false, ...overrides };
}

describe("PickWire", () => {
  it("reserves the band even with zero picks — the fixed-height slot, not the list, is what's always there", () => {
    render(<PickWire view={SNAKE_VIEW} teams={TEAMS} playersById={playersById(PLAYERS)} players={PLAYERS} />);
    const band = screen.getByTestId("pick-wire");
    expect(band).toBeInTheDocument();
    expect(band).toHaveTextContent("");
    // The anti-reflow contract itself (review of this task): the band is a FIXED height with
    // single-line clipping, and the default (room) variant reads at text-xs. Class assertions,
    // because this is exactly the property a refactor to min-h-8 (or a dropped truncate) would
    // silently lose while every behavioral test stayed green.
    expect(band.className).toMatch(/\bh-8\b/);
    expect(band.className).toMatch(/\btruncate\b/);
    expect(band.className).toMatch(/\btext-xs\b/);
  });

  it("renders newest pick first, with team, player, and position", () => {
    const picks = [
      pick({ pickNumber: 1, teamId: "t1", playerId: "qb1" }),
      pick({ pickNumber: 2, teamId: "t2", playerId: "rb1" }),
    ];
    render(<PickWire view={{ ...SNAKE_VIEW, picks }} teams={TEAMS} playersById={playersById(PLAYERS)} players={PLAYERS} />);
    const band = screen.getByTestId("pick-wire");
    const text = band.textContent ?? "";
    expect(text.indexOf("Marcus Reed")).toBeLessThan(text.indexOf("Jalen Croft"));
    expect(text).toContain("#2 Iron Owls");
    expect(text).toContain("Marcus Reed");
    expect(text).toContain("RB");
    expect(text).toContain("#1 Bay Bandits");
    expect(text).toContain("Jalen Croft");
    expect(text).toContain("QB");
    // The separator is spec ("separated by ·"): two items means exactly one interpunct.
    expect(text.split("\u00b7")).toHaveLength(2);
  });

  it("gives only the newest item's player name ink — every other item stays quiet", () => {
    const picks = [
      pick({ pickNumber: 1, teamId: "t1", playerId: "qb1" }),
      pick({ pickNumber: 2, teamId: "t2", playerId: "rb1" }),
    ];
    render(<PickWire view={{ ...SNAKE_VIEW, picks }} teams={TEAMS} playersById={playersById(PLAYERS)} players={PLAYERS} />);
    const newest = screen.getByText("Marcus Reed");
    const oldest = screen.getByText("Jalen Croft");
    expect(newest.className).toMatch(/text-text-primary/);
    expect(newest.className).toMatch(/font-semibold/);
    expect(oldest.className).not.toMatch(/text-text-primary/);
  });

  // `PositionBadge` itself is allowlisted (`no-uppercase.source.test.ts`) to spell the class on
  // the position sticker — an acronym transform, not styled shouting — so this checks the
  // BAND'S OWN source, the file this task actually owns, rather than the rendered DOM.
  it("never spells the class Tailwind uses for shouted text", () => {
    const source = readFileSync(join(process.cwd(), "src/draft-room/components/pick-wire.tsx"), "utf8");
    expect(source).not.toContain("uppercase");
  });

  it(`renders at most ${DRAFT_ROOM_CONFIG.wire.maxItems} picks even deep in a draft`, () => {
    const roster = ["qb1", "rb1", "rb2", "wr1"];
    const picks: CompletedPick[] = Array.from({ length: 20 }, (_, index) =>
      pick({ pickNumber: index + 1, teamId: index % 2 === 0 ? "t1" : "t2", playerId: roster[index % roster.length]! }),
    );
    render(<PickWire view={{ ...SNAKE_VIEW, picks }} teams={TEAMS} playersById={playersById(PLAYERS)} players={PLAYERS} />);
    const band = screen.getByTestId("pick-wire");
    const items = band.querySelectorAll("li");
    expect(items.length).toBe(DRAFT_ROOM_CONFIG.wire.maxItems);
    // Newest pick (#20) leads; the oldest surviving item is exactly `maxItems` picks back.
    expect(band).toHaveTextContent("#20");
    expect(band).not.toHaveTextContent(`#${20 - DRAFT_ROOM_CONFIG.wire.maxItems}`);
  });

  it("renders identically for an auction pick — a completed pick is a completed pick", () => {
    const auctionPick = pick({ pickNumber: 1, teamId: "t1", playerId: "qb1", price: 42 });
    render(<PickWire view={{ ...SNAKE_VIEW, format: "auction", picks: [auctionPick] }} teams={TEAMS} playersById={playersById(PLAYERS)} players={PLAYERS} />);
    const band = screen.getByTestId("pick-wire");
    expect(band).toHaveTextContent("#1 Bay Bandits");
    expect(band).toHaveTextContent("Jalen Croft");
    expect(band).not.toHaveTextContent("$42");
  });

  it("skips an item whose player id can't be resolved instead of crashing", () => {
    const picks = [pick({ pickNumber: 1, teamId: "t1", playerId: "ghost-player" })];
    expect(() => render(<PickWire view={{ ...SNAKE_VIEW, picks }} teams={TEAMS} playersById={playersById(PLAYERS)} players={PLAYERS} />)).not.toThrow();
    expect(screen.getByTestId("pick-wire")).toHaveTextContent("");
  });

  /**
   * TASK 7, THE VERDICT (the fun pass). The band records what happened; the chip on its newest
   * item says whether it was any good. Only the newest, and only when there is a verdict to
   * give: six chips on a one-line band would be a scoreboard the band has no width for, and an
   * "even" pick has no verdict at all.
   */
  describe("the newest pick's verdict (Task 7)", () => {
    // wr1 is the board's 4th player. Taken at pick 12 he lasted eight picks past his rank; the
    // three earlier picks went straight down the board, so the room has a population to rank
    // that against.
    const straightPicks = [
      pick({ pickNumber: 1, teamId: "t1", playerId: "qb1" }),
      pick({ pickNumber: 2, teamId: "t2", playerId: "rb1" }),
      pick({ pickNumber: 3, teamId: "t1", playerId: "rb2" }),
    ];

    it("calls out a steal on the pick that just landed", () => {
      const picks = [...straightPicks, pick({ pickNumber: 12, teamId: "t2", playerId: "wr1" })];
      render(<PickWire view={{ ...SNAKE_VIEW, picks }} teams={TEAMS} playersById={playersById(PLAYERS)} players={PLAYERS} />);
      const band = screen.getByTestId("pick-wire");
      expect(band).toHaveTextContent("+8");
      expect(band).toHaveTextContent("steal");
    });

    it("judges only the newest item, never the five behind it", () => {
      const picks = [...straightPicks, pick({ pickNumber: 12, teamId: "t2", playerId: "wr1" }), pick({ pickNumber: 13, teamId: "t1", playerId: "qb1" })];
      render(<PickWire view={{ ...SNAKE_VIEW, picks }} teams={TEAMS} playersById={playersById(PLAYERS)} players={PLAYERS} />);
      const band = screen.getByTestId("pick-wire");
      // #13 (qb1, board rank 1, taken twelve picks late) leads and carries the chip; wr1's own
      // "+8" from the item behind it is gone.
      expect(band).toHaveTextContent("+12");
      expect(band).not.toHaveTextContent("+8");
    });

    it("says nothing at all when the newest pick matched the board", () => {
      render(<PickWire view={{ ...SNAKE_VIEW, picks: straightPicks }} teams={TEAMS} playersById={playersById(PLAYERS)} players={PLAYERS} />);
      const band = screen.getByTestId("pick-wire");
      expect(band).not.toHaveTextContent("steal");
      expect(band).not.toHaveTextContent("reach");
    });

    it("stays one line: the chip is inline, never a block that would break the band", () => {
      const picks = [...straightPicks, pick({ pickNumber: 12, teamId: "t2", playerId: "wr1" })];
      render(<PickWire view={{ ...SNAKE_VIEW, picks }} teams={TEAMS} playersById={playersById(PLAYERS)} players={PLAYERS} />);
      const chip = screen.getByTestId("pick-wire").querySelector("[data-magnitude]")!;
      expect(chip.tagName).toBe("SPAN");
    });
  });

  // The house copy rule bans both dash characters (`@/integrity/copy-rules`); this band used to
  // carry an em dash between the team and the player.
  it("writes no em or en dash", () => {
    const picks = [pick({ pickNumber: 1, teamId: "t1", playerId: "qb1" })];
    render(<PickWire view={{ ...SNAKE_VIEW, picks }} teams={TEAMS} playersById={playersById(PLAYERS)} players={PLAYERS} />);
    expect(screen.getByTestId("pick-wire").textContent ?? "").not.toMatch(/[—–]/);
  });

  it("renders at TV scale when asked", () => {
    const picks = [pick({ pickNumber: 1, teamId: "t1", playerId: "qb1" })];
    render(<PickWire view={{ ...SNAKE_VIEW, picks }} teams={TEAMS} playersById={playersById(PLAYERS)} players={PLAYERS} variant="tv" />);
    expect(screen.getByTestId("pick-wire").className).toMatch(/text-base/);
  });

  // Task 3 (player-name adoption sweep): the room variant's name is pressable; the TV keeps
  // every control inert (standing law).
  describe("player names (task 3)", () => {
    const picks = [pick({ pickNumber: 1, teamId: "t1", playerId: "qb1" })];

    it("makes the room variant's newest-pick name a pressable button that opens the season peek, axe-clean", async () => {
      const { container } = render(
        <LeagueRoomDepsProvider deps={{ fetchJson: () => new Promise(() => {}), openEventSource: () => ({ addEventListener: () => {}, close: () => {} }) }}>
          <PlayerPeekHost />
          <PickWire view={{ ...SNAKE_VIEW, picks }} teams={TEAMS} playersById={playersById(PLAYERS)} players={PLAYERS} />
        </LeagueRoomDepsProvider>,
      );
      const name = screen.getByRole("button", { name: "Jalen Croft" });
      expect(await axe(container)).toHaveNoViolations();
      await act(async () => {
        fireEvent.click(name);
      });
      expect(screen.getByRole("dialog", { name: "Jalen Croft" })).toBeInTheDocument();
    });

    it("keeps the TV variant's name inert — no control on it is ever clickable", () => {
      render(<PickWire view={{ ...SNAKE_VIEW, picks }} teams={TEAMS} playersById={playersById(PLAYERS)} players={PLAYERS} variant="tv" />);
      expect(screen.getByText("Jalen Croft").tagName).toBe("SPAN");
      expect(screen.queryByRole("button", { name: "Jalen Croft" })).not.toBeInTheDocument();
    });
  });
});
