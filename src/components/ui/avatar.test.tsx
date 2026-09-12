import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Avatar } from "./avatar";
import { renderSurface } from "./test-utils";

describe("Avatar", () => {
  it("falls back to initials and stays decorative by default, in both themes", async () => {
    await renderSurface(<Avatar name="Dana Whitfield" />, async ({ container }) => {
      expect(screen.getByText("DW")).toBeInTheDocument();
      expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("uses a single initial for a one-word name and ignores middle words", () => {
    const { rerender } = render(<Avatar name="Prince" />);
    expect(screen.getByText("P")).toBeInTheDocument();
    rerender(<Avatar name="  ada  byron   lovelace " />);
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("shows a question mark rather than nothing for a blank name", () => {
    render(<Avatar name="   " />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  /**
   * FIX ROUND 2. These two used to assert that a stored https ref rendered as an `<img>` and that
   * a failed load fell back to initials. Neither state is reachable now: `parseAvatarRef` resolves
   * every remote value to `initials` while `IDENTITY_CONFIG.avatar.uploads` is false, because the
   * only writer of a URL was the identity sync and what it wrote was a GENERATED PLACEHOLDER, not
   * a picture of the manager (the founder's own ring on production `/app`). The `<img>` and its
   * `onError` fallback stay in the component for Plan D, which is the plan that flips the flag and
   * brings a test of them back with real uploaded refs to point at.
   */
  it("never renders a provider URL as a face while uploads are off", () => {
    const { container } = render(<Avatar name="Dana Whitfield" avatar="https://workoscdn.com/u/a.png" />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("DW")).toBeInTheDocument();
  });

  it("becomes an accessible image when labelled", async () => {
    const { container } = render(<Avatar name="Dana Whitfield" label="Dana Whitfield" />);
    expect(screen.getByRole("img", { name: "Dana Whitfield" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders a chosen preset as an icon, both themes, no axe violations", async () => {
    await renderSurface(<Avatar name="Ada Lovelace" avatar="preset:shield" label="Ada Lovelace" />, async ({ container }) => {
      expect(screen.getByRole("img", { name: "Ada Lovelace" })).toBeInTheDocument();
      expect(container.querySelector("svg")).not.toBeNull();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("falls back to initials rather than an image for a value it will not render", () => {
    render(<Avatar name="Ada Lovelace" avatar="javascript:alert(1)" />);
    expect(screen.getByText("AL")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});
