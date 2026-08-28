import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { Position } from "@/domain/player";
import { PositionBadge } from "./position-badge";
import { renderSurface } from "./test-utils";

const ALL: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

describe("PositionBadge", () => {
  it("renders the position on its own sticker color, both themes, axe-clean", async () => {
    await renderSurface(
      <p>
        Drafted <PositionBadge position="QB" />
      </p>,
      async ({ container }) => {
        expect(screen.getByText("QB")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("gives every position its own sticker fill and its own on-sticker label color", () => {
    const { container } = render(
      <>
        {ALL.map((position) => (
          <PositionBadge key={position} position={position} />
        ))}
      </>,
    );
    const classNames = ALL.map((position) => screen.getByText(position).className);
    for (const [index, position] of ALL.entries()) {
      const role = position.toLowerCase();
      expect(classNames[index]).toContain(`bg-pos-${role}`);
      expect(classNames[index]).toContain(`text-pos-${role}-on`);
    }
    // Six distinct fills — no two positions may share a class string.
    expect(new Set(classNames).size).toBe(ALL.length);
    expect(container.querySelectorAll("span")).toHaveLength(ALL.length);
  });

  it("uses the display face, never the body face", () => {
    render(<PositionBadge position="TE" />);
    expect(screen.getByText("TE").className).toContain("font-display");
  });

  /**
   * TWO FACTS, ONE STICKER. The rank costs no extra eye stop and no extra column, and it is the
   * question a manager scanning a board is actually asking. Optional, so every surface with no
   * ranked board behind it renders exactly what it rendered before.
   */
  describe("the positional rank", () => {
    it("prints the rank on the sticker, in both themes, with no axe violations", async () => {
      await renderSurface(<PositionBadge position="RB" rank={4} />, async ({ container }) => {
        expect(screen.getByText("RB4")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      });
    });

    it("renders the plain position when no caller states a rank", () => {
      render(<PositionBadge position="RB" />);
      expect(screen.getByText("RB")).toBeInTheDocument();
    });

    it("costs the rank rather than printing a lie when the number is not a real ordinal", () => {
      // A caller bug — a zero, a negative, a fraction off some average — must never reach a
      // manager as "RB0" or "RB1.5", which he would read as a fact. The sticker is still correct.
      for (const rank of [0, -3, 1.5, Number.NaN]) {
        const { unmount } = render(<PositionBadge position="WR" rank={rank} />);
        expect(screen.getByText("WR")).toBeInTheDocument();
        unmount();
      }
    });
  });
});
