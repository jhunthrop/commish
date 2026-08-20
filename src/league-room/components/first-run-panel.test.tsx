import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { firstRunPlan } from "@/identity";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { FirstRunPanel } from "./first-run-panel";

// `CreateLeaguePanel` and `JoinLeagueEntry`, both embedded here, navigate via `next/navigation`'s
// `useRouter` — stubbed the same way `create-league-panel.test.tsx` and `join-form.test.tsx` do,
// since this is a real render of the whole panel, not a shallow one.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

const GUIDED_BEGINNER = firstRunPlan({ experienceTier: "beginner", helpLevel: "guided", leagueCount: 0 })!;
const STANDARD_EXPERIENCED = firstRunPlan({ experienceTier: "experienced", helpLevel: "standard", leagueCount: 0 })!;

function renderPanel(plan = GUIDED_BEGINNER) {
  const fixture = fixtureLeagueDeps({ ok: true, data: {} });
  return renderInLeague(<FirstRunPanel plan={plan} />, fixture.deps);
}

describe("FirstRunPanel", () => {
  it("renders all three paths, in the plan's own order, with real titles and detail", async () => {
    await inBothThemes(<FirstRunPanel plan={GUIDED_BEGINNER} />, async ({ container }) => {
      const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
      expect(headings).toEqual(["Find an open league", "Join with an invite", "Start a league"]);
      expect(screen.getByText("Browse leagues that still have seats and join one today.")).toBeInTheDocument();
      expect(screen.getByText("Paste the link or code your commissioner sent you.")).toBeInTheDocument();
      expect(screen.getByText("You pick the format, the scoring and who's in it.")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("shows the explainer only when the plan says to", () => {
    renderPanel(GUIDED_BEGINNER);
    expect(screen.getByText(/A league is a group of managers/)).toBeInTheDocument();
  });

  it("omits the explainer when the plan says not to", () => {
    renderPanel(STANDARD_EXPERIENCED);
    expect(screen.queryByText(/A league is a group of managers/)).not.toBeInTheDocument();
  });

  it("reorders for an experienced manager, create leading", () => {
    renderPanel(STANDARD_EXPERIENCED);
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Start a league", "Join with an invite", "Find an open league"]);
  });

  it("gives every path a real, working control, not a description-only card", () => {
    renderPanel(GUIDED_BEGINNER);
    // browse: a real link, labeled with the plan's own cta text, to the real page.
    expect(screen.getByRole("link", { name: "Browse open leagues" })).toHaveAttribute("href", "/browse");
    // join: the actual invite-entry form, not a placeholder.
    expect(screen.getByLabelText("Invite link or code")).toBeInTheDocument();
    // create: the actual create form, not a placeholder.
    expect(screen.getByLabelText("League name")).toBeInTheDocument();
  });

  it("gives the create path id=\"create-league\", the anchor every other surface links to", () => {
    renderPanel(GUIDED_BEGINNER);
    const nameInput = screen.getByLabelText("League name");
    const section = nameInput.closest("#create-league");
    expect(section).not.toBeNull();
  });
});
