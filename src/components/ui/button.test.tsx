import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Button } from "./button";
import { renderSurface } from "./test-utils";

describe("Button", () => {
  it("renders its label and calls onClick, in both themes, with no axe violations", async () => {
    await renderSurface(<Button onClick={() => {}}>Draft player</Button>, async ({ container }) => {
      expect(screen.getByRole("button", { name: "Draft player" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("when loading: is disabled, aria-busy, keeps its label, and swallows clicks", () => {
    const onClick = vi.fn();
    const { getByRole } = render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const btn = getByRole("button", { name: /Save/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("applies the variant class", () => {
    const { getByRole } = render(<Button variant="destructive">Delete</Button>);
    expect(getByRole("button").className).toMatch(/negative/);
  });

  // v3 rule 5 (Task 4): the primary is the INK PILL — ink fill, ground text, pill radius —
  // and green is never a button fill again.
  it("primary is the ink pill: bg-text-primary text-surface, pill radius, no accent fill", () => {
    const { getByRole } = render(<Button>Take a seat</Button>);
    const className = getByRole("button").className;
    expect(className).toContain("rounded-pill");
    expect(className).toContain("bg-text-primary");
    expect(className).toContain("text-surface");
    expect(className).not.toContain("bg-accent");
  });

  it("secondary is the quiet pill: transparent, edge-bordered (a control boundary clears 3:1), pill radius", () => {
    const { getByRole } = render(<Button variant="secondary">Browse open leagues</Button>);
    const className = getByRole("button").className;
    expect(className).toContain("rounded-pill");
    expect(className).toContain("border-edge");
    expect(className).toContain("bg-transparent");
    expect(className).not.toContain("border-line");
  });

  // V6 (the warmth pass): the verb keeps its solid amber — still the one solid per surface —
  // and gains the soft glow token, the mocks' halo under DRAFT, riding each theme's own accent.
  it("verb is the glowing solid: accent fill, verb radius, the shadow-verb-glow token", () => {
    const { getByRole } = render(<Button variant="verb">Draft</Button>);
    const className = getByRole("button").className;
    expect(className).toContain("bg-accent");
    expect(className).toContain("rounded-md");
    expect(className).toContain("shadow-verb-glow");
  });

  it("destructive keeps its negative fill and joins the pill; ghost keeps rounded-md and no pill", () => {
    const destructive = render(<Button variant="destructive">Delete</Button>);
    expect(destructive.getByRole("button").className).toContain("rounded-pill");
    expect(destructive.getByRole("button").className).toContain("bg-negative");
    destructive.unmount();
    const ghost = render(<Button variant="ghost">Dismiss</Button>);
    expect(ghost.getByRole("button").className).toContain("rounded-md");
    expect(ghost.getByRole("button").className).not.toContain("rounded-pill");
  });

  it("keeps the accent focus ring on every variant", () => {
    for (const variant of ["primary", "secondary", "destructive", "ghost"] as const) {
      const { getByRole, unmount } = render(<Button variant={variant}>Act</Button>);
      expect(getByRole("button").className).toContain("focus-visible:ring-accent");
      unmount();
    }
  });

  it("renders every variant axe-clean in both themes", async () => {
    await renderSurface(
      <div>
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="ghost">Ghost</Button>
      </div>,
      async ({ container }) => {
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });
});
