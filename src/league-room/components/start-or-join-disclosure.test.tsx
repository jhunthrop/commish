import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { StartOrJoinDisclosure } from "./start-or-join-disclosure";

// `CreateLeaguePanel` and `JoinLeagueEntry`, both embedded here, navigate via `next/navigation`'s
// `useRouter` — stubbed the same way `create-league-panel.test.tsx` does.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

afterEach(() => {
  window.location.hash = "";
});

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
    await inBothThemes(<StartOrJoinDisclosure experienceTier="beginner" />, async ({ container }) => {
      expect(detailsElement().open).toBe(false);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("opens on load when the URL fragment targets the create-league anchor", () => {
    window.location.hash = "#create-league";
    render(<StartOrJoinDisclosure experienceTier="beginner" />);
    expect(detailsElement().open).toBe(true);
  });

  it("stays closed on load for any other, or no, fragment", () => {
    window.location.hash = "#something-else";
    render(<StartOrJoinDisclosure experienceTier="beginner" />);
    expect(detailsElement().open).toBe(false);
  });

  it("still resolves the #create-league anchor to a real, present section, because three other surfaces link to it", () => {
    render(<StartOrJoinDisclosure experienceTier="beginner" />);
    // `.getElementById` mirrors exactly what a browser fragment navigation resolves against —
    // present regardless of the disclosure's open/closed state, which is what makes the anchor
    // itself never a broken link even before the hash-driven open-on-load effect runs.
    expect(document.getElementById("create-league")).not.toBeNull();
  });

  it("contains all three real, working paths: join, browse and create", () => {
    render(<StartOrJoinDisclosure experienceTier="beginner" />);
    expect(screen.getByLabelText("Invite link or code")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse open leagues" })).toHaveAttribute("href", "/browse");
    expect(screen.getByLabelText("League name")).toBeInTheDocument();
  });

  /**
   * Phase 3.5, Task 9's promotion, proven through the SAME nesting a returning manager actually
   * reaches it through: this outer disclosure wraps `CreateLeaguePanel`, which wraps
   * `CreateLeagueForm`. Neither control needs the outer disclosure's own `<details>` marked
   * `open` to be present in the DOM (`render` mounts it regardless, same as every other section
   * here), and it needs no INNER "Advanced settings" disclosure opened at all — the property this
   * whole task exists to prove.
   */
  it("carries who-can-join and who-it's-for straight through into the create section, unopened", () => {
    render(<StartOrJoinDisclosure experienceTier="beginner" />);
    expect(screen.getByLabelText("Who can join")).toBeInTheDocument();
    expect(screen.getByLabelText("Who it's for")).toBeInTheDocument();
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

  it("keeps the #create-league anchor resolving to the create section in EITHER order", () => {
    for (const experienceTier of ["beginner", "experienced"] as const) {
      const { unmount } = render(<StartOrJoinDisclosure experienceTier={experienceTier} />);
      const nameInput = screen.getByLabelText("League name");
      expect(nameInput.closest("#create-league")).not.toBeNull();
      unmount();
    }
  });

  it("opens on the create-league fragment regardless of where create sits in the order", () => {
    window.location.hash = "#create-league";
    for (const experienceTier of ["beginner", "experienced"] as const) {
      const { unmount } = render(<StartOrJoinDisclosure experienceTier={experienceTier} />);
      expect(detailsElement().open).toBe(true);
      unmount();
    }
  });
});
