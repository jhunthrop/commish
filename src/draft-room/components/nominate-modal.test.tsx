import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { AUCTION_VIEW } from "../test-fixtures";

import { NominateModal } from "./nominate-modal";

const props = {
  open: true,
  playerId: "qb1",
  playerName: "Jalen Croft",
  view: AUCTION_VIEW,
  myTeamId: "t1",
  onClose: () => {},
  onNominate: () => {},
};

describe("NominateModal", () => {
  it("names the player in the dialog title and states the legal opening range — both themes, axe-clean", async () => {
    await inBothThemes(<NominateModal {...props} />, async ({ container }) => {
      expect(screen.getByRole("dialog", { name: "Nominate Jalen Croft" })).toBeInTheDocument();
      expect(screen.getByLabelText("Opening bid")).toHaveAttribute("min", "1");
      expect(screen.getByLabelText("Opening bid")).toHaveAttribute("max", "97");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("renders nothing when closed", () => {
    render(<NominateModal {...props} open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape and hands focus back to the opener", () => {
    const onClose = vi.fn();
    const opener = document.createElement("button");
    opener.textContent = "Open";
    document.body.appendChild(opener);
    opener.focus();

    const { rerender } = render(<NominateModal {...props} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();

    rerender(<NominateModal {...props} onClose={onClose} open={false} />);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("submits the typed opening bid", () => {
    const onNominate = vi.fn();
    render(<NominateModal {...props} onNominate={onNominate} />);
    fireEvent.change(screen.getByLabelText("Opening bid"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Nominate for $9" }));
    expect(onNominate).toHaveBeenCalledWith("qb1", 9);
  });
});
