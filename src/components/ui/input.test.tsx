import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Input } from "./input";
import { renderSurface } from "./test-utils";

describe("Input", () => {
  it("has a visible label associated with the control, both themes, no axe violations", async () => {
    await renderSurface(<Input label="League name" />, async ({ container }) => {
      expect(screen.getByLabelText("League name")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });
  it("links error text via aria-describedby and sets aria-invalid", () => {
    render(<Input label="Email" error="Enter a valid email address." />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const describedBy = input.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe("Enter a valid email address.");
  });
  it("shows a hint when provided", () => {
    render(<Input label="Team name" hint="You can change this later." />);
    expect(screen.getByText("You can change this later.")).toBeInTheDocument();
  });
  it("has disabled styling parity with Select (dimmed, not-allowed cursor)", () => {
    render(<Input label="Team name" disabled />);
    const input = screen.getByLabelText("Team name");
    expect(input).toBeDisabled();
    expect(input.className).toMatch(/disabled:opacity-60/);
    expect(input.className).toMatch(/disabled:cursor-not-allowed/);
  });
});
