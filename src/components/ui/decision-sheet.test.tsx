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

  it("is a labelled modal dialog with the accent border", () => {
    render(sheet(true));
    const dialog = screen.getByRole("dialog", { name: "Fix your WR2" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.className).toContain("border-accent");
  });

  it("states the context and the way out beside the headline", () => {
    render(sheet(true));
    expect(screen.getByText("Zay Flowers is on bye Sunday")).toBeTruthy();
    expect(screen.getByText("esc backs out")).toBeTruthy();
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
