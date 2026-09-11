import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SegmentGroup } from "./segment-group";

const OPTIONS = [
  { value: "3", label: "3" },
  { value: "5", label: "5" },
  { value: "10", label: "10" },
];

describe("SegmentGroup", () => {
  it("presses exactly the active segment and reports a change by value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentGroup label="Show" options={OPTIONS} value="5" onChange={onChange} />);
    const group = screen.getByRole("group", { name: "Show" });
    expect(group.querySelectorAll("[aria-pressed='true']")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "5" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "10" }));
    expect(onChange).toHaveBeenCalledWith("10");
  });

  it("has a compact size for a row inside a card, smaller than the default rail", () => {
    const { rerender } = render(<SegmentGroup label="Show" options={OPTIONS} value="5" onChange={() => {}} labelled={false} />);
    const rail = screen.getByRole("button", { name: "5" }).className;
    expect(rail).toContain("py-2");
    rerender(<SegmentGroup label="Show" options={OPTIONS} value="5" onChange={() => {}} labelled={false} size="sm" />);
    const compact = screen.getByRole("button", { name: "5" }).className;
    expect(compact).toContain("py-1");
    expect(compact).not.toContain("py-2");
    expect(screen.getByRole("group", { name: "Show" }).className).toContain("text-sm");
  });
});
