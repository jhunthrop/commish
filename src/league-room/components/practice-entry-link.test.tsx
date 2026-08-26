import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PracticeEntryLink } from "./practice-entry-link";

describe("PracticeEntryLink", () => {
  it("goes straight to the practice lobby when signed in", () => {
    const { getByRole } = render(<PracticeEntryLink signedIn={true} />);
    expect(getByRole("link", { name: "Try a practice draft" })).toHaveAttribute("href", "/app/mock-drafts");
  });

  it("goes through sign-up, carrying the lobby as its own intent, when signed out", () => {
    const { getByRole } = render(<PracticeEntryLink signedIn={false} />);
    expect(getByRole("link", { name: "Try a practice draft" })).toHaveAttribute(
      "href",
      "/sign-up?returnTo=%2Fapp%2Fmock-drafts",
    );
  });

  it("renders as the quiet outlined pill, never ink", () => {
    const { getByRole } = render(<PracticeEntryLink signedIn={true} />);
    const link = getByRole("link", { name: "Try a practice draft" });
    expect(link.className).toContain("border-edge");
    expect(link.className).not.toContain("bg-text-primary");
  });
});
