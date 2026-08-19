import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { LEAGUES } from "../test-fixtures";
import { LeagueList } from "./league-list";

describe("LeagueList", () => {
  it("lists each league with how full it is, surfacing draft state only when it is actionable, in both themes", async () => {
    await inBothThemes(<LeagueList leagues={LEAGUES} />, async ({ container }) => {
      expect(screen.getByRole("link", { name: /Sunday Money/ })).toHaveAttribute("href", "/app/leagues/l1");
      expect(screen.getByText(/8 of 12 managers/)).toBeInTheDocument();
      // Scheduled draft → a way into the room; a finished draft says nothing (the league
      // home is the action, and the card never shouts about the past).
      expect(screen.getByRole("link", { name: "Open the draft room" })).toHaveAttribute("href", "/app/drafts/d1");
      expect(screen.queryByText(/Draft complete/)).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("gives a LIVE draft the loud treatment: badge, ring, and a direct way in", () => {
    render(<LeagueList leagues={[{ ...LEAGUES[0]!, draftStatus: "in_progress" }]} />);
    expect(screen.getByText("Draft live")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join the draft" })).toHaveAttribute("href", "/app/drafts/d1");
  });

  it("offers a next action when there are no leagues yet, in both themes", async () => {
    await inBothThemes(<LeagueList leagues={[]} />, async ({ container }) => {
      expect(screen.getByText("No leagues yet")).toBeInTheDocument();
      expect(screen.getByText(/Create one below/)).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("marks the leagues the caller runs", () => {
    render(<LeagueList leagues={LEAGUES} />);
    expect(screen.getByText(/· Commissioner/)).toBeInTheDocument();
  });
});
