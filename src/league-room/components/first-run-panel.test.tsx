import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { firstRunPlan } from "@/identity";
import { PROFILE } from "@/account-room/test-fixtures";
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
  return renderInLeague(<FirstRunPanel plan={plan} profile={PROFILE} />, fixture.deps);
}

describe("FirstRunPanel", () => {
  it("asks a brand new manager who they are, before it asks them to pick a league", () => {
    renderSurface(<FirstRunPanel plan={GUIDED_BEGINNER} profile={PROFILE} />, ({ getAllByRole }) => {
      expect(getAllByRole("heading", { level: 3 })[0]).toHaveTextContent("Set up your manager profile");
    });
  });

  // Derived-only, exactly like the parent's attention queue (ruling 11). The identity step is
  // shown while `firstRunPlan` is non-null, which is precisely "this manager has zero leagues".
  // Joining is the dismissal; there is no seen-flag, no column and no snooze.
  it("stops asking the moment they are in a league, with nothing to dismiss and nothing stored", () => {
    renderSurface(<FirstRunPanel plan={null} profile={PROFILE} />, ({ container }) => {
      expect(container.textContent).not.toContain("Set up your manager profile");
    });
  });

  it("says what the experience answer actually does, because it decides which leagues they can see", () => {
    renderSurface(<FirstRunPanel plan={GUIDED_BEGINNER} profile={PROFILE} />, ({ getByText }) => {
      expect(
        getByText("Some leagues are kept for newer players. Your answer here decides which ones you see."),
      ).toBeInTheDocument();
    });
  });

  // The founder's centralization rule, tested: a first-run copy of the name and tier fields is
  // exactly the page-local mapping that rule exists to stop, and it would drift within a phase.
  it("renders the same ProfileForm the profile page renders, not a second one", () => {
    renderPanel(GUIDED_BEGINNER);
    expect(screen.getByLabelText("Display name")).toHaveValue(PROFILE.displayName);
    expect(screen.getByRole("option", { name: "New to fantasy" })).toBeInTheDocument();
    expect(
      screen.getByText("We use this to match you to leagues and to show you the right amount of help."),
    ).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Avatar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("renders all five cards — the identity step, then practice, then all three paths, in the plan's own order, with real titles and detail", async () => {
    await renderSurface(<FirstRunPanel plan={GUIDED_BEGINNER} profile={PROFILE} />, async ({ container }) => {
      const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
      expect(headings).toEqual([
        "Set up your manager profile",
        "Try a mock draft",
        "Find an open league",
        "Join with an invite",
        "Start a league",
      ]);
      expect(screen.getByText("Run a mock draft against practice opponents anytime, before your real league starts.")).toBeInTheDocument();
      expect(screen.getByText("Browse leagues that still have seats and join one today.")).toBeInTheDocument();
      expect(screen.getByText("Paste the link or code your commissioner sent you.")).toBeInTheDocument();
      expect(screen.getByText("You pick the format, the scoring and who is in it.")).toBeInTheDocument();
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

  it("reorders for an experienced manager, create leading — the identity card and practice both stay put", () => {
    renderPanel(STANDARD_EXPERIENCED);
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "Set up your manager profile",
      "Try a mock draft",
      "Start a league",
      "Join with an invite",
      "Find an open league",
    ]);
  });

  it("gives every path a real, working control, not a description-only card", () => {
    renderPanel(GUIDED_BEGINNER);
    // practice: the real, signed-in practice lobby link.
    expect(screen.getByRole("link", { name: "Try a mock draft" })).toHaveAttribute("href", "/app/mock-drafts");
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
