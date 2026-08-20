import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { GLOSSARY } from "@/help/glossary";
import { UI_CONFIG } from "./config";
import { inBothThemes } from "./test-utils";
import { InfoTip } from "./info-tip";

describe("InfoTip", () => {
  it("reveals a definition on click and hides it again, with no hover in the mechanism", async () => {
    // Hover-only help fails WCAG 2.2's 1.4.13 and does not exist on a phone, which is this
    // product's minimum viewport. The control is a real button with aria-expanded.
    render(<InfoTip term="snake-draft" />);
    const trigger = screen.getByRole("button", { name: "What is a snake draft?" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("note")).toHaveTextContent("picks run 1 to 12, then 12 to 1");
    await userEvent.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("toggles closed on a second click, without needing Escape", async () => {
    render(<InfoTip term="ppr" />);
    const trigger = screen.getByRole("button", { name: "What is PPR?" });
    await userEvent.click(trigger);
    expect(screen.getByRole("note")).toBeInTheDocument();
    await userEvent.click(trigger);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("never shows the short line inline outside guided help level", () => {
    render(<InfoTip term="ppr" />);
    expect(screen.queryByText(GLOSSARY.ppr.short)).not.toBeInTheDocument();
    render(<InfoTip term="ppr" helpLevel="standard" />);
    expect(screen.queryByText(GLOSSARY.ppr.short)).not.toBeInTheDocument();
  });

  it("prints the short line inline for a guided reader, with no click needed", () => {
    render(<InfoTip term="ppr" helpLevel="guided" />);
    expect(screen.getByText(GLOSSARY.ppr.short)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is PPR?" })).toHaveAttribute("aria-expanded", "false");
  });

  // Controller promotion (WCAG 2.2 SC 2.5.8, AA): a pointer target must be at least 24x24 CSS
  // pixels, even though the visible glyph inside stays small.
  it("meets the WCAG 2.2 AA minimum pointer target size, hit area not glyph", () => {
    render(<InfoTip term="ppr" />);
    const trigger = screen.getByRole("button", { name: "What is PPR?" });
    expect(trigger.style.minWidth).toBe(`${UI_CONFIG.infoTip.minTargetPx}px`);
    expect(trigger.style.minHeight).toBe(`${UI_CONFIG.infoTip.minTargetPx}px`);
    expect(UI_CONFIG.infoTip.minTargetPx).toBeGreaterThanOrEqual(24);
  });

  it("renders in both themes with no axe violations, closed and open", async () => {
    await inBothThemes(<InfoTip term="matchup" />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
    await inBothThemes(<InfoTip term="matchup" helpLevel="guided" />, async ({ container }) => {
      await userEvent.click(screen.getByRole("button", { name: "What is a matchup?" }));
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
