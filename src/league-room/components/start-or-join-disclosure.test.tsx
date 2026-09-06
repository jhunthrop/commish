import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { StartOrJoinDisclosure } from "./start-or-join-disclosure";
import type { CreateSheetDefaults } from "./create-sheet";
import { CreateLeagueSheetHost } from "./create-league-sheet";

// `JoinLeagueEntry`, embedded here, navigates via `next/navigation`'s `useRouter` — stubbed the
// same way `create-league-panel.test.tsx` does.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

const SHEET_DEFAULTS: CreateSheetDefaults = { teamCount: 12, scoringPreset: "half_ppr", draftDaysFromCreation: 7 };

function detailsElement(): HTMLDetailsElement {
  const summary = screen.getByText("Start or join another league");
  const details = summary.closest("details");
  if (details === null) throw new Error("summary is not inside a <details>");
  return details;
}

/** Section headings in DOM order, so ordering assertions read as plainly as `firstRunPlan`'s own. */
function sectionHeadingOrder(): string[] {
  return screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
}

describe("StartOrJoinDisclosure", () => {
  it("is closed by default, in both themes, with no accessibility violations", async () => {
    await renderSurface(<StartOrJoinDisclosure experienceTier="beginner" />, async ({ container }) => {
      expect(detailsElement().open).toBe(false);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("contains all three real, working paths: join, browse and a create trigger", () => {
    render(<StartOrJoinDisclosure experienceTier="beginner" />);
    expect(screen.getByLabelText("Invite link or code")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse open leagues" })).toHaveAttribute("href", "/browse");
    expect(screen.getByRole("button", { name: "Start a league" })).toBeInTheDocument();
  });

  /**
   * THE HASH STORY MOVED (2026-09-05): this disclosure no longer reads `#create-league` at all
   * — `CreateLeagueSheetHost` (`./create-league-sheet.tsx`) does, and opens the sheet directly.
   * Mounted here as a sibling the way `AppShell` mounts it for real, this proves the create
   * TRIGGER inside the (still closed) disclosure reaches that same host.
   */
  it("opens the create-league sheet from the trigger row, without ever opening itself", () => {
    render(
      <>
        <CreateLeagueSheetHost defaults={SHEET_DEFAULTS} />
        <StartOrJoinDisclosure experienceTier="beginner" />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Start a league" }));
    expect(screen.getByRole("dialog", { name: "Start a league" })).toBeInTheDocument();
    // The outer disclosure is unrelated state — the sheet is an overlay, never something that
    // needs this `<details>` expanded underneath it.
    expect(detailsElement().open).toBe(false);
  });

  it("orders browse and join ahead of create for a beginner, the same rule firstRunPlan uses", () => {
    render(<StartOrJoinDisclosure experienceTier="beginner" />);
    expect(sectionHeadingOrder()).toEqual(["No group to play with yet?", "Invited by a friend?", "Start a league"]);
  });

  it("orders create first for an experienced manager, the same rule firstRunPlan uses", () => {
    // A high-stakes veteran opening this disclosure to start their fourth league of the season
    // is usually reaching for Create — `firstRunPathOrder` (@/identity/first-run.ts) already
    // encodes exactly this for the zero-leagues fork, and this component reuses it rather than
    // inventing a second, possibly-contradicting opinion.
    render(<StartOrJoinDisclosure experienceTier="experienced" />);
    expect(sectionHeadingOrder()).toEqual(["Start a league", "Invited by a friend?", "No group to play with yet?"]);
  });
});
