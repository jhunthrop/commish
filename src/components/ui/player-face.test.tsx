import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { PlayerFace, type PlayerFaceSize } from "./player-face";
import { TOKENS } from "@/design/tokens";
import type { Player } from "@/domain/player";

const CROFT: Player = { id: "rb1", name: "Jalen Croft", position: "RB", nflTeam: "KC", headshotUrl: null, adp: 1.6 };

/** A code no feed we map emits — a free agent, or a club code that changed its mind. */
const FREE_AGENT: Player = { id: "fa1", name: "Rory Vance", position: "WR", nflTeam: "FA", headshotUrl: null, adp: null };

describe("PlayerFace", () => {
  it("puts the club's own colour behind the face, decoratively, and names the team in data", async () => {
    // Rule 1's team-identity amendment: the colour is a tile the size of the face and nothing
    // else. `aria-hidden` because it states no fact a screen reader needs — the team code is in
    // text beside it wherever this renders, which is what keeps the colour from being the only
    // channel.
    await renderSurface(<PlayerFace player={CROFT} />, async ({ container }) => {
      const tile = screen.getByTestId("player-face-team");
      expect(tile).toHaveAttribute("aria-hidden", "true");
      expect(tile).toHaveAttribute("data-team", "KC");
      expect(tile.getAttribute("style")).toContain("background-color");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("takes the colour from the one palette allowed to hold it, never a literal of its own", () => {
    render(<PlayerFace player={CROFT} />);
    // The tile's inline style has to BE `TOKENS.team.KC` — this is the assertion that fails if a
    // future edit hard-codes a hex here instead of reading the token (`no-raw-color`'s sweep
    // catches the literal; this catches the wrong VALUE).
    const style = screen.getByTestId("player-face-team").getAttribute("style")!;
    expect(style.toLowerCase()).toContain(TOKENS.team.KC.toLowerCase());
  });

  it("renders a bare face for a team it has no colour for, rather than a grey rectangle pretending", async () => {
    // Degrading to nothing is the honest answer, and the palette's own docblock commits to it
    // from the other side. Initials still identify the man.
    await renderSurface(<PlayerFace player={FREE_AGENT} />, async ({ container }) => {
      expect(screen.queryByTestId("player-face-team")).toBeNull();
      expect(screen.getByText("RV")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("pairs each tile step with its own avatar step, so the colour frame is the same width everywhere", () => {
    // The visible colour IS the gap between tile and face. A caller choosing the two halves
    // separately is how one surface gets a 2px frame and its neighbour a 6px one, so the pairing
    // is the component's and the size prop is a single word.
    const cases: ReadonlyArray<readonly [PlayerFaceSize, string, string]> = [
      ["sm", "size-8", "size-6"],
      ["md", "size-11", "size-8"],
      ["lg", "size-14", "size-12"],
    ];
    for (const [size, tile, avatar] of cases) {
      const { unmount } = render(<PlayerFace player={CROFT} size={size} />);
      const tileEl = screen.getByTestId("player-face-team");
      expect(tileEl.className).toContain(tile);
      expect(tileEl.firstElementChild!.className).toContain(avatar);
      unmount();
    }
  });

  it("defaults to md, the card-and-roster step, so a caller that says nothing gets the middle one", () => {
    render(<PlayerFace player={CROFT} />);
    expect(screen.getByTestId("player-face-team").className).toContain("size-11");
  });

  it("keeps the size promise on the bare face too — an unknown team changes the colour, not the layout", () => {
    render(<PlayerFace player={FREE_AGENT} size="lg" />);
    expect(screen.getByText("RV").parentElement!.className).toContain("size-12");
  });
});
