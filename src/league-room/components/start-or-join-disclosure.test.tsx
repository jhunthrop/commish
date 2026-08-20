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

describe("StartOrJoinDisclosure", () => {
  it("is closed by default, in both themes, with no accessibility violations", async () => {
    await inBothThemes(<StartOrJoinDisclosure />, async ({ container }) => {
      expect(detailsElement().open).toBe(false);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("opens on load when the URL fragment targets the create-league anchor", () => {
    window.location.hash = "#create-league";
    render(<StartOrJoinDisclosure />);
    expect(detailsElement().open).toBe(true);
  });

  it("stays closed on load for any other, or no, fragment", () => {
    window.location.hash = "#something-else";
    render(<StartOrJoinDisclosure />);
    expect(detailsElement().open).toBe(false);
  });

  it("still resolves the #create-league anchor to a real, present section, because three other surfaces link to it", () => {
    render(<StartOrJoinDisclosure />);
    // `.getElementById` mirrors exactly what a browser fragment navigation resolves against —
    // present regardless of the disclosure's open/closed state, which is what makes the anchor
    // itself never a broken link even before the hash-driven open-on-load effect runs.
    expect(document.getElementById("create-league")).not.toBeNull();
  });

  it("contains all three real, working paths: join, browse and create", () => {
    render(<StartOrJoinDisclosure />);
    expect(screen.getByLabelText("Invite link or code")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse open leagues" })).toHaveAttribute("href", "/browse");
    expect(screen.getByLabelText("League name")).toBeInTheDocument();
  });
});
