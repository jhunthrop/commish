import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { TeamRow } from "./team-row";
import { PlayerRow } from "./player-row";
import { BigNumber } from "./big-number";
import type { Player } from "@/domain/player";

const GIBBS: Player = { id: "rb1", name: "Jahmyr Gibbs", position: "RB", nflTeam: "DET", headshotUrl: null, adp: 4.1 };

describe("TeamRow", () => {
  it("draws the club as an object — ring, name, a Team badge, the meta line — axe-clean in both themes", async () => {
    await renderSurface(<TeamRow code="DET" name="Detroit Lions" meta="DET · Bye 8" />, async ({ container }) => {
      expect(screen.getByText("Detroit Lions")).toBeInTheDocument();
      expect(screen.getByText("Team")).toBeInTheDocument();
      expect(screen.getByText("DET · Bye 8")).toBeInTheDocument();
      expect(screen.getByTestId("player-face-team")).toHaveAttribute("data-team", "DET");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("wears exactly the shell and highlight PlayerRow wears, so the two read as one list", () => {
    const { container: team } = render(<TeamRow code="DET" name="Detroit Lions" highlight />);
    const { container: player } = render(<PlayerRow player={GIBBS} highlight />);
    expect(team.firstElementChild!.className).toBe(player.firstElementChild!.className);
    expect(team.firstElementChild).toHaveAttribute("data-highlight", "true");
    const { container: plain } = render(<TeamRow code="DET" name="Detroit Lions" />);
    expect(plain.firstElementChild).not.toHaveAttribute("data-highlight");
  });

  it("is never itself a control", () => {
    const { container } = render(<TeamRow code="DET" name="Detroit Lions" />);
    const row = container.firstElementChild!;
    expect(row.tagName).toBe("DIV");
    expect(row).not.toHaveAttribute("role");
    expect(row).not.toHaveAttribute("tabindex");
  });
  /** P2 on a club's row: whatever number the surface rendering it has for a club, with its basis
   *  under it — the same slot, the same contract and the same right edge as `PlayerRow`'s. */
  it("carries one number at its right when the surface has one", () => {
    render(<TeamRow code="DET" name="Detroit Lions" figure={<BigNumber value="8" basis="Bye week" size="sm" />} />);
    expect(screen.getByTestId("big-number")).toBeInTheDocument();
    expect(screen.getByText("Bye week")).toBeInTheDocument();
  });

  it("reserves no empty box when it was given none", () => {
    const { container } = render(<TeamRow code="DET" name="Detroit Lions" />);
    expect(container.firstElementChild!.children).toHaveLength(2);
  });
});
