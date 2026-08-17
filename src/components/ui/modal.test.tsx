import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { useState } from "react";
import { Modal } from "./modal";
import { Button } from "./button";
import { inBothThemes } from "./test-utils";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button onClick={() => setOpen(true)}>Nominate a player</Button>
      <Modal open={open} title="Nominate a player" onClose={() => setOpen(false)}>
        <Button>Confirm</Button>
      </Modal>
    </div>
  );
}

describe("Modal", () => {
  it("renders nothing while closed", () => {
    render(<Modal open={false} title="Nominate a player" onClose={() => {}}>body</Modal>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a labelled aria-modal dialog, axe-clean in both themes", async () => {
    await inBothThemes(
      <Modal open title="Nominate a player" onClose={() => {}}>
        <p>Choose an opening bid.</p>
      </Modal>,
      async ({ container }) => {
        const dialog = screen.getByRole("dialog", { name: "Nominate a player" });
        expect(dialog).toHaveAttribute("aria-modal", "true");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Modal open title="Nominate a player" onClose={onClose}>body</Modal>);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus into the dialog on open and back to the opener on close", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Nominate a player" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(opener).toHaveFocus();
  });

  it("cycles Tab inside the dialog instead of escaping to the page", () => {
    render(
      <Modal open title="Nominate a player" onClose={() => {}} footer={<Button>Confirm</Button>}>
        <Button>Cancel</Button>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Confirm" });

    confirm.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
  });

  it("ignores keys that are neither Escape nor Tab", () => {
    const onClose = vi.fn();
    render(<Modal open title="Nominate a player" onClose={onClose}><Button>Cancel</Button></Modal>);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
