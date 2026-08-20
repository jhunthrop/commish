import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { THREE_TEAMS } from "../test-fixtures";
import { LeagueMembersPanel } from "./league-members-panel";

describe("LeagueMembersPanel", () => {
  it("names the commissioner, marks you, and gives every manager a face", async () => {
    await inBothThemes(
      <LeagueMembersPanel teams={THREE_TEAMS} commissionerUserId="u1" myTeamId="t2" />,
      async ({ container }) => {
        expect(screen.getByRole("list", { name: "Managers" })).toBeInTheDocument();
        // The commissioner is named as a fact about the league, not implied by a control only
        // they can see: every member can find out who runs the league they are in.
        expect(screen.getByText("Commissioner")).toBeInTheDocument();
        expect(screen.getByText("You")).toBeInTheDocument();
        // "gives every manager a face" is a third of this test's name and used to have zero
        // assertions behind it. Every manager gets an `Avatar`, and one with no stored ref falls
        // back to initials rather than rendering an empty circle.
        // These fixtures carry no stored avatar ref, so a face here is `Avatar`'s initials
        // fallback — the case that must never render an empty circle.
        THREE_TEAMS.forEach((team) => {
          expect(screen.getByText(team.ownerDisplayName)).toBeInTheDocument();
        });
        expect(screen.getByText("AR")).toBeInTheDocument();
        expect(screen.getByText("JL")).toBeInTheDocument();
        expect(screen.getByText("SP")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("shows an open seat as an open seat, not as a missing person", () => {
    render(<LeagueMembersPanel teams={THREE_TEAMS} teamCount={6} commissionerUserId="u1" myTeamId="t2" />);
    expect(screen.getByText("3 seats still open")).toBeInTheDocument();
  });

  it("says nothing about open seats when the caller doesn't supply a team count", () => {
    render(<LeagueMembersPanel teams={THREE_TEAMS} commissionerUserId="u1" myTeamId="t2" />);
    expect(screen.queryByText(/seats? still open/)).not.toBeInTheDocument();
  });

  it("marks only the commissioner's own row, not every row", () => {
    render(<LeagueMembersPanel teams={THREE_TEAMS} commissionerUserId="u1" myTeamId="t2" />);
    expect(screen.getAllByText("Commissioner")).toHaveLength(1);
  });

  it("marks nobody as you for a viewer with no team of their own", () => {
    render(<LeagueMembersPanel teams={THREE_TEAMS} commissionerUserId="u1" myTeamId={null} />);
    expect(screen.queryByText("You")).not.toBeInTheDocument();
  });

  it("shows every manager's name, in both themes, axe-clean", async () => {
    await inBothThemes(
      <LeagueMembersPanel teams={THREE_TEAMS} commissionerUserId="u1" myTeamId="t2" />,
      async ({ container }) => {
        expect(screen.getByText("Alex Rivera")).toBeInTheDocument();
        expect(screen.getByText("Jordan Lee")).toBeInTheDocument();
        expect(screen.getByText("Sam Patel")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("offers a next step rather than a dead end when a league somehow has no members yet, in both themes", async () => {
    await inBothThemes(
      <LeagueMembersPanel teams={[]} commissionerUserId="u1" myTeamId={null} />,
      async ({ container }) => {
        expect(screen.getByText("Nobody's here yet")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  // House style: no em-dashes in user-facing copy (`src/matchmaking/filter.test.ts`,
  // `src/data/seed/seed-public-leagues.test.ts` assert the same on a single string each). This
  // component renders several strings — the empty state's description among them — so the
  // sweep runs over the FULL rendered text of both states rather than pinning one string.
  it("never renders an em-dash, in the filled state or the empty state", () => {
    const { container: filled } = render(
      <LeagueMembersPanel teams={THREE_TEAMS} teamCount={6} commissionerUserId="u1" myTeamId="t2" />,
    );
    expect(filled.textContent).not.toContain("—");

    const { container: empty } = render(<LeagueMembersPanel teams={[]} commissionerUserId="u1" myTeamId={null} />);
    expect(empty.textContent).not.toContain("—");
  });
});
