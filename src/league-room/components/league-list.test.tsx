import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { LEAGUES } from "../test-fixtures";
import { LeagueList } from "./league-list";

describe("LeagueList", () => {
  it("lists each league with how full it is and what its draft is doing, in both themes", async () => {
    await inBothThemes(<LeagueList leagues={LEAGUES} />, async ({ container }) => {
      expect(screen.getByRole("link", { name: /Sunday Money/ })).toHaveAttribute("href", "/app/leagues/l1");
      expect(screen.getByText("8 of 12 managers")).toBeInTheDocument();
      expect(screen.getByText("Draft not started")).toBeInTheDocument();
      expect(screen.getByText("Draft complete")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
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
    expect(screen.getByText("Commissioner")).toBeInTheDocument();
  });
});
