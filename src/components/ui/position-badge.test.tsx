import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { Position } from "@/domain/player";
import { PositionBadge } from "./position-badge";
import { inBothThemes } from "./test-utils";

const ALL: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

describe("PositionBadge", () => {
  it("renders the position on its own sticker color, both themes, axe-clean", async () => {
    await inBothThemes(
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
});
