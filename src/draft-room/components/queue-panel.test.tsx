import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { PLAYERS, playersById } from "../test-fixtures";
import { QueuePanel } from "./queue-panel";

const props = {
  playersById: playersById(PLAYERS),
  availablePlayerIds: ["qb1", "rb1", "rb2", "wr1"],
  busy: false,
};

describe("QueuePanel", () => {
  it("lists the queue in order, in both themes, axe-clean", async () => {
    await inBothThemes(<QueuePanel {...props} queue={["rb1", "qb1"]} onChange={vi.fn()} />, async ({ container }) => {
      const rows = screen.getAllByRole("listitem");
      expect(rows[0]).toHaveTextContent("Marcus Reed");
      expect(rows[1]).toHaveTextContent("Jalen Croft");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("offers a next action when the queue is empty, in both themes", async () => {
    await inBothThemes(<QueuePanel {...props} queue={[]} onChange={vi.fn()} />, async ({ container }) => {
      expect(screen.getByText("Nobody queued yet")).toBeInTheDocument();
      expect(screen.getByText(/Add players from the pool/)).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("moves and removes through named, keyboard-reachable buttons", () => {
    const onChange = vi.fn();
    render(<QueuePanel {...props} queue={["rb1", "qb1"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Move Jalen Croft up" }));
    expect(onChange).toHaveBeenLastCalledWith(["qb1", "rb1"]);
    fireEvent.click(screen.getByRole("button", { name: "Move Marcus Reed down" }));
    expect(onChange).toHaveBeenLastCalledWith(["qb1", "rb1"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Marcus Reed from your queue" }));
    expect(onChange).toHaveBeenLastCalledWith(["qb1"]);
  });

  it("marks a queued player who has already been drafted", () => {
    render(<QueuePanel {...props} availablePlayerIds={["qb1"]} queue={["rb1", "qb1"]} onChange={vi.fn()} />);
    expect(screen.getByText("Drafted")).toBeInTheDocument();
  });

  it("disables every control while a change is in flight", () => {
    render(<QueuePanel {...props} busy queue={["rb1"]} onChange={vi.fn()} />);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });
});
