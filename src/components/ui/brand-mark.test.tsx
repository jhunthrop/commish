import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrandMark, BrandLockup } from "./brand-mark";

describe("BrandMark", () => {
  it("is decorative (aria-hidden) by default", () => {
    const { container } = render(<BrandMark />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("is an accessible image when given a label", () => {
    render(<BrandMark label="Commish" />);
    expect(screen.getByRole("img", { name: "Commish" })).toBeInTheDocument();
  });
});

describe("BrandLockup", () => {
  it("renders the wordmark with an accent-colored terminal period", () => {
    const { container } = render(<BrandLockup />);
    expect(screen.getByText("Commish")).toBeInTheDocument();
    const period = container.querySelector(".text-accent");
    expect(period).not.toBeNull();
    expect(period).toHaveTextContent(".");
  });

  it("renders its mark decoratively, so a wrapping link controls the accessible name", () => {
    const { container } = render(<BrandLockup />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
