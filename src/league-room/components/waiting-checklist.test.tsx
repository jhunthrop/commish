import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { WaitingChecklist, type WaitingChecklistItem } from "./waiting-checklist";

const firstTimerItems: readonly WaitingChecklistItem[] = [
  { key: "tour", heading: "See how the draft room works", body: "A quick look before it is your turn for real." },
  { key: "name", heading: "Name your team", body: "This is what the room will call you all season." },
  { key: "rank", heading: "Rank your draft slots", body: "Higher choices win more often than luck alone.", content: <p>The ranking panel</p> },
  { key: "notices", heading: "Turn on notices", body: "So you hear the room the moment it fills." },
];

describe("WaitingChecklist", () => {
  it("puts the room tour first for a manager who has never drafted", () => {
    render(<WaitingChecklist items={firstTimerItems} />);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("See how the draft room works");
  });

  it("renders every item's heading, body and content, in both themes, axe-clean", async () => {
    await renderSurface(<WaitingChecklist items={firstTimerItems} />, async ({ container }) => {
      for (const item of firstTimerItems) {
        expect(screen.getByText(item.heading)).toBeInTheDocument();
        expect(screen.getByText(item.body)).toBeInTheDocument();
      }
      expect(screen.getByText("The ranking panel")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("renders as an ordered list, since the four items are a sequence to work through", () => {
    render(<WaitingChecklist items={firstTimerItems} />);
    expect(screen.getByRole("list", { name: "Get ready" }).tagName).toBe("OL");
  });

  it("respects whatever order the caller hands it, veteran-last included", () => {
    const veteranOrder = [...firstTimerItems].reverse();
    render(<WaitingChecklist items={veteranOrder} />);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Turn on notices");
    expect(screen.getAllByRole("listitem")[3]).toHaveTextContent("See how the draft room works");
  });
});
