import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { Button } from "./button";
import { DecisionSheet } from "./decision-sheet";

const sheet = (open: boolean, onClose = vi.fn()) => (
  <DecisionSheet
    open={open}
    title="Fix your WR2"
    meta="Zay Flowers is on bye Sunday"
    onClose={onClose}
    footer={
      <>
        <Button variant="secondary">Back</Button>
        <Button variant="verb" className="ml-auto">
          Start Doubs
        </Button>
      </>
    }
  >
    <p>Two bench receivers project higher than an empty slot.</p>
  </DecisionSheet>
);

describe("DecisionSheet", () => {
  it("renders nothing while closed", () => {
    const { container } = render(sheet(false));
    expect(container).toBeEmptyDOMElement();
  });

  it("is a labelled modal dialog wearing the accent attention ring", () => {
    // "The room is asking you to decide" is a soft ring in the accent's own family, not a solid
    // border wire. Sideline wave two spends the accent's own GLOW ROLE for it rather than a
    // hand-mixed opacity, so the ring is the identical tint `Badge`'s glow already spends.
    render(sheet(true));
    const dialog = screen.getByRole("dialog", { name: "Fix your WR2" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.className).toContain("ring-accent-glow");
    expect(dialog.className).not.toContain("border-accent");
  });

  it("states the context beside the headline and explains nothing else", () => {
    render(sheet(true));
    expect(screen.getByText("Zay Flowers is on bye Sunday")).toBeTruthy();
    // P7: no explainer text. "esc backs out" was a sentence whose only job was to explain another
    // element, and the behaviour it described is unchanged (see the escape test below).
    expect(screen.queryByText("esc backs out")).toBeNull();
  });

  it("escape backs out without committing", () => {
    const onClose = vi.fn();
    render(sheet(true, onClose));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes focus on open so tab starts inside the decision", () => {
    render(sheet(true));
    expect(document.activeElement?.textContent).toBe("Back");
  });

  it("traps tab at the last verb", () => {
    render(sheet(true));
    const verb = screen.getByRole("button", { name: "Start Doubs" });
    verb.focus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
    expect(document.activeElement?.textContent).toBe("Back");
  });

  it("has no axe violations in either theme", async () => {
    await renderSurface(sheet(true), async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
