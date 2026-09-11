import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { ButtonLink } from "./button-link";
import { buttonClassName } from "./button";
import { renderSurface } from "./test-utils";

describe("ButtonLink", () => {
  it("renders a link with its href and label, in both themes, with no axe violations", async () => {
    await renderSurface(<ButtonLink href="/browse">Take a seat</ButtonLink>, async ({ container }) => {
      const link = screen.getByRole("link", { name: "Take a seat" });
      expect(link).toHaveAttribute("href", "/browse");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("wears exactly Button's class map — one source of truth, two elements", () => {
    const { getByRole } = render(
      <ButtonLink href="/x" variant="secondary" size="sm" className="w-fit">
        Browse
      </ButtonLink>,
    );
    expect(getByRole("link").className).toBe(buttonClassName("secondary", "sm", "w-fit"));
  });

  it("defaults to the Court blue pill (primary, md)", () => {
    const { getByRole } = render(<ButtonLink href="/x">Go</ButtonLink>);
    const className = getByRole("link").className;
    expect(className).toBe(buttonClassName("primary", "md"));
    expect(className).toContain("rounded-pill");
    expect(className).toContain("bg-accent");
    expect(className).toContain("text-accent-text");
  });

  it("renders the quiet pill for secondary", () => {
    const { getByRole } = render(
      <ButtonLink href="/x" variant="secondary">
        Also possible
      </ButtonLink>,
    );
    const className = getByRole("link").className;
    expect(className).toContain("rounded-pill");
    expect(className).toContain("border-edge");
    expect(className).toContain("bg-transparent");
  });

  it("passes through anchor attributes like aria-label", () => {
    const { getByRole } = render(
      <ButtonLink href="/x" aria-label="Fix lineup for Bay Bandits">
        Fix lineup
      </ButtonLink>,
    );
    expect(getByRole("link", { name: "Fix lineup for Bay Bandits" })).toBeInTheDocument();
  });
});
