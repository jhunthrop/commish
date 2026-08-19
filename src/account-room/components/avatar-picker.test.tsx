import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { AVATAR_PRESETS } from "@/identity";
import { AvatarPicker } from "./avatar-picker";

describe("AvatarPicker", () => {
  it("renders all eight presets as a labelled radio group, in both themes, axe-clean", async () => {
    await inBothThemes(
      <AvatarPicker displayName="Ada Lovelace" value={null} onChange={vi.fn()} />,
      async ({ container }) => {
        expect(screen.getByRole("radiogroup", { name: "Avatar" })).toBeInTheDocument();
        const radios = screen.getAllByRole("radio");
        expect(radios).toHaveLength(AVATAR_PRESETS.length);
        for (const preset of AVATAR_PRESETS) {
          expect(screen.getByRole("radio", { name: preset.label })).toBeInTheDocument();
        }
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("marks the value's tile checked, and nothing else", () => {
    render(<AvatarPicker displayName="Ada Lovelace" value="flame" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Flame" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Shield" })).toHaveAttribute("aria-checked", "false");
  });

  it("only the checked tile is tabbable — the first tile, when nothing is chosen yet", () => {
    render(<AvatarPicker displayName="Ada Lovelace" value={null} onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Shield" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Flame" })).toHaveAttribute("tabindex", "-1");
  });

  it("clicking a tile reports its key", () => {
    const onChange = vi.fn();
    render(<AvatarPicker displayName="Ada Lovelace" value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Trophy" }));
    expect(onChange).toHaveBeenCalledWith("trophy");
  });

  it("ArrowRight moves focus and selection to the next tile, wrapping past the last", () => {
    const onChange = vi.fn();
    const { rerender } = render(<AvatarPicker displayName="Ada Lovelace" value="clover" onChange={onChange} />);
    screen.getByRole("radio", { name: "Clover" }).focus();
    fireEvent.keyDown(screen.getByRole("radio", { name: "Clover" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("shield");
    rerender(<AvatarPicker displayName="Ada Lovelace" value="shield" onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "Shield" })).toHaveFocus();
  });

  it("ArrowLeft moves focus and selection to the previous tile, wrapping before the first", () => {
    const onChange = vi.fn();
    const { rerender } = render(<AvatarPicker displayName="Ada Lovelace" value="shield" onChange={onChange} />);
    screen.getByRole("radio", { name: "Shield" }).focus();
    fireEvent.keyDown(screen.getByRole("radio", { name: "Shield" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith("clover");
    rerender(<AvatarPicker displayName="Ada Lovelace" value="clover" onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "Clover" })).toHaveFocus();
  });

  it("Home and End jump to the first and last tile", () => {
    const onChange = vi.fn();
    render(<AvatarPicker displayName="Ada Lovelace" value="flame" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "Flame" }), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("clover");
    fireEvent.keyDown(screen.getByRole("radio", { name: "Flame" }), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("shield");
  });
});
