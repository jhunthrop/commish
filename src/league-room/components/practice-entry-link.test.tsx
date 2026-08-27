import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PracticeEntryLink } from "./practice-entry-link";

describe("PracticeEntryLink", () => {
  it("goes straight to the practice lobby when signed in", () => {
    const { getByRole } = render(<PracticeEntryLink signedIn={true} />);
    expect(getByRole("link", { name: "Try a mock draft" })).toHaveAttribute("href", "/app/mock-drafts");
  });

  // B2 (flow analysis): signed out, the label states the truth (an account is required) before
  // the visitor ever clicks — the same "No account is needed to look." sentence sits right above
  // it, and the two must never contradict each other again.
  it("goes through sign-up, carrying the lobby as its own intent, when signed out — and says so in the label", () => {
    const { getByRole, queryByRole } = render(<PracticeEntryLink signedIn={false} />);
    expect(getByRole("link", { name: "Sign up and try a mock draft" })).toHaveAttribute(
      "href",
      "/sign-up?returnTo=%2Fapp%2Fmock-drafts",
    );
    expect(queryByRole("link", { name: "Try a mock draft" })).not.toBeInTheDocument();
  });

  it("renders as the quiet outlined pill, never ink", () => {
    const { getByRole } = render(<PracticeEntryLink signedIn={true} />);
    const link = getByRole("link", { name: "Try a mock draft" });
    expect(link.className).toContain("border-edge");
    expect(link.className).not.toContain("bg-text-primary");
  });

  // D1-storefront: the pill wraps itself in `self-start` so a stretching `flex-col` ancestor can
  // never inflate it to the container's full width again.
  it("wraps itself in a self-start block, immune to a stretching flex-col parent", () => {
    const { getByRole } = render(<PracticeEntryLink signedIn={true} className="mt-1" />);
    const link = getByRole("link", { name: "Try a mock draft" });
    const wrapper = link.parentElement;
    expect(wrapper?.className).toContain("self-start");
    expect(wrapper?.className).toContain("mt-1");
  });
});
