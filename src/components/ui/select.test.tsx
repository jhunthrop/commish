import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { Select } from "./select";
import { renderSurface } from "./test-utils";

const POSITIONS = [
  { value: "ALL", label: "All positions" },
  { value: "QB", label: "Quarterback" },
  { value: "RB", label: "Running back" },
];

describe("Select", () => {
  it("has a visible label, renders its options, and is axe-clean in both themes", async () => {
    await renderSurface(<Select label="Position" options={POSITIONS} defaultValue="ALL" />, async ({ container }) => {
      const select = screen.getByLabelText("Position");
      expect(select.tagName).toBe("SELECT");
      expect(screen.getByRole("option", { name: "Running back" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("reports the chosen value to onChange", () => {
    const onChange = vi.fn();
    render(<Select label="Position" options={POSITIONS} defaultValue="ALL" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Position"), { target: { value: "QB" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText("Position") as HTMLSelectElement).value).toBe("QB");
  });

  it("links its hint and error text and marks itself invalid", () => {
    render(<Select label="Position" options={POSITIONS} hint="Filter the pool." error="Pick a position." />);
    const select = screen.getByLabelText("Position");
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect((select.getAttribute("aria-describedby") ?? "").split(" ")).toHaveLength(2);
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a position.");
    expect(screen.getByText("Filter the pool.")).toBeInTheDocument();
  });

  it("is disabled when asked", () => {
    render(<Select label="Position" options={POSITIONS} disabled />);
    expect(screen.getByLabelText("Position")).toBeDisabled();
  });

  it("draws its boundary in border-edge, never the decorative border-line (D1)", () => {
    render(<Select label="Position" options={POSITIONS} />);
    const select = screen.getByLabelText("Position");
    expect(select.className).toContain("border-edge");
    expect(select.className).not.toContain("border-line");
  });
});
