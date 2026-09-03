import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { LeagueAuthority } from "@/league-service/authority";
import { THREE_TEAMS } from "../test-fixtures";
import { LeagueMembersPanel } from "./league-members-panel";

const MEMBER: LeagueAuthority = { kind: "member", userId: "u1" };
const HOUSE: LeagueAuthority = { kind: "house", rung: "open_12" };

describe("LeagueMembersPanel", () => {
  it("names the commissioner, marks you, and gives every manager a face", async () => {
    await renderSurface(
      <LeagueMembersPanel teams={THREE_TEAMS} authority={MEMBER} myTeamId="t2" />,
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

  it("shows the open seats through SeatMeter, not a sentence of its own (F17)", () => {
    render(<LeagueMembersPanel teams={THREE_TEAMS} teamCount={6} authority={MEMBER} myTeamId="t2" />);
    expect(screen.getByText("3 of 6 seated")).toBeInTheDocument();
  });

  it("says nothing about seats when the caller doesn't supply a team count", () => {
    render(<LeagueMembersPanel teams={THREE_TEAMS} authority={MEMBER} myTeamId="t2" />);
    expect(screen.queryByText(/seated/)).not.toBeInTheDocument();
  });

  // Phase 3.6, Task 9 (ruling 19): the SAME coarse composition line `RoomRoster` shows, never a
  // per-manager history tag on any one row.
  it("carries the room's coarse composition line beside the seat count, when the caller supplies one", () => {
    render(<LeagueMembersPanel teams={THREE_TEAMS} teamCount={6} authority={MEMBER} myTeamId="t2" compositionCategory="all_newcomers" />);
    expect(screen.getByText("All newcomers")).toBeInTheDocument();
  });

  it("says nothing about composition when the caller doesn't supply one", () => {
    render(<LeagueMembersPanel teams={THREE_TEAMS} teamCount={6} authority={MEMBER} myTeamId="t2" />);
    expect(screen.queryByText(/newcomers|Open to everyone/)).not.toBeInTheDocument();
  });

  it("marks only the commissioner's own row, not every row", () => {
    render(<LeagueMembersPanel teams={THREE_TEAMS} authority={MEMBER} myTeamId="t2" />);
    expect(screen.getAllByText("Commissioner")).toHaveLength(1);
  });

  it("marks nobody as you for a viewer with no team of their own", () => {
    render(<LeagueMembersPanel teams={THREE_TEAMS} authority={MEMBER} myTeamId={null} />);
    expect(screen.queryByText("You")).not.toBeInTheDocument();
  });

  it("shows every manager's name, in both themes, axe-clean", async () => {
    await renderSurface(
      <LeagueMembersPanel teams={THREE_TEAMS} authority={MEMBER} myTeamId="t2" />,
      async ({ container }) => {
        expect(screen.getByText("Alex Rivera")).toBeInTheDocument();
        expect(screen.getByText("Jordan Lee")).toBeInTheDocument();
        expect(screen.getByText("Sam Patel")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("offers a next step rather than a dead end when a league somehow has no members yet, in both themes", async () => {
    await renderSurface(
      <LeagueMembersPanel teams={[]} authority={MEMBER} myTeamId={null} />,
      async ({ container }) => {
        expect(screen.getByText("Nobody is here yet")).toBeInTheDocument();
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
      <LeagueMembersPanel teams={THREE_TEAMS} teamCount={6} authority={MEMBER} myTeamId="t2" />,
    );
    expect(filled.textContent).not.toContain("—");

    const { container: empty } = render(<LeagueMembersPanel teams={[]} authority={MEMBER} myTeamId={null} />);
    expect(empty.textContent).not.toContain("—");
  });

  // Phase 3.5 addendum, Task 12, Step 5: a house league's authority never matches any team's
  // `ownerUserId`, so the badge simply never renders — correct but silent without the line
  // above the roster stating the fact.
  describe("a house league", () => {
    it("states who runs it instead of leaving the absent badge to be inferred", async () => {
      await renderSurface(
        <LeagueMembersPanel teams={THREE_TEAMS} authority={HOUSE} myTeamId="t2" />,
        async ({ container }) => {
          expect(screen.getByText(/Run by Commish/)).toBeInTheDocument();
          expect(await axe(container)).toHaveNoViolations();
        },
      );
    });

    it("marks no member's row as commissioner", () => {
      render(<LeagueMembersPanel teams={THREE_TEAMS} authority={HOUSE} myTeamId="t2" />);
      expect(screen.queryByText("Commissioner")).not.toBeInTheDocument();
    });

    it("never renders an em-dash", () => {
      const { container } = render(<LeagueMembersPanel teams={THREE_TEAMS} authority={HOUSE} myTeamId="t2" />);
      expect(container.textContent).not.toContain("—");
    });

    // Sunday v5 (founder ruling 2026-08-28, "the UX should explain itself — we shouldn't need
    // tips"): the "house league" InfoTip beside "Run by Commish" is gone outright, not merely
    // re-gated by `helpLevel` — the plain sentence is the whole of it.
    it("prints 'Run by Commish' as a plain sentence, no tip", () => {
      render(<LeagueMembersPanel teams={THREE_TEAMS} authority={HOUSE} myTeamId="t2" />);
      expect(screen.getByText(/Run by Commish/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "What is a house league?" })).not.toBeInTheDocument();
    });
  });

  // A member-run league already answers "who runs this" via the "Commissioner" badge on the
  // right row, so the "Run by Commish" sentence is house-only.
  it("shows no 'Run by Commish' sentence for a member-run league", () => {
    render(<LeagueMembersPanel teams={THREE_TEAMS} authority={MEMBER} myTeamId="t2" />);
    expect(screen.queryByText(/Run by Commish/)).not.toBeInTheDocument();
  });
});
