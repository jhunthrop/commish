import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Player } from "@/domain/player";
import { advisorView, nextPick } from "../test-view";
import { NextPickCard, type NextPickCardProps } from "./next-pick-card";

const PLAYER: Player = { id: "rb1", name: "Marcus Reed", position: "RB", nflTeam: "KC", headshotUrl: null, adp: 2 };

function renderCard(over: Partial<NextPickCardProps> = {}) {
  const props: NextPickCardProps = {
    view: advisorView(),
    acts: { canDraft: true, submitting: false, queueOrder: new Map(), onDraft: vi.fn(), onQueueToggle: vi.fn() },
    player: PLAYER,
    byeWeek: 10,
    recomputing: false,
    ...over,
  };
  return { ...render(<NextPickCard {...props} />), props };
}

describe("NextPickCard", () => {
  it("is one header line, one row with the face, the name, the facts and the odds as the row's big figure, the why and the verb, axe-clean", async () => {
    const { container } = renderCard();
    expect(screen.getByTestId("advisor-header")).toHaveTextContent("You're on the clock");
    expect(screen.getByTestId("player-face-team")).toHaveAttribute("data-team", "KC");
    expect(screen.getByTestId("advisor-name")).toHaveTextContent("Marcus Reed");
    expect(screen.getByTestId("advisor-facts")).toHaveTextContent("RB 3, KC, bye 10");
    expect(screen.getByTestId("advisor-facts")).toHaveAttribute("title", "41.2 points over replacement on our board");
    const row = screen.getByTestId("advisor-lead-row");
    expect(row).toContainElement(screen.getByTestId("advisor-odds"));
    expect(screen.getByTestId("advisor-odds")).toHaveTextContent("92 of 200");
    expect(screen.getByText("still there at 2.10 if you pass")).toBeInTheDocument();
    expect(screen.getByTestId("advisor-why")).toHaveTextContent(/20.6 point drop/);
    expect(screen.getByTestId("advisor-stamp")).toHaveTextContent("As of 1.01 · 200 runs");
    expect(screen.queryByText(/value over replacement/)).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("keeps the card compact: a medium face, no display-size figure, a small verb", () => {
    renderCard();
    expect(screen.getByTestId("player-face-team").className).toContain("size-11");
    expect(screen.getByTestId("advisor-odds").className).not.toContain("display-lg");
    expect(screen.getByRole("button", { name: "Draft" }).className).toContain("min-h-9");
  });

  it("colours the big number green only at or above the safe band, never red", () => {
    renderCard({ view: advisorView({ pick: nextPick({ makeItBack: { survival: 0.7, runs: 200 } }) }) });
    expect(screen.getByTestId("advisor-odds")).toHaveAttribute("data-band", "safe");
    expect(screen.getByTestId("advisor-odds").className).toContain("text-positive");
  });

  it("keeps a reach in plain ink", () => {
    renderCard({ view: advisorView({ pick: nextPick({ makeItBack: { survival: 0.1, runs: 200 } }) }) });
    expect(screen.getByTestId("advisor-odds")).toHaveAttribute("data-band", "plain");
    expect(screen.getByTestId("advisor-odds").className).not.toContain("text-negative");
  });

  it("puts Draft on the card on the clock and routes it through the room's own pick path", async () => {
    const user = userEvent.setup();
    const { props } = renderCard();
    expect(screen.queryByRole("button", { name: "Queue" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Draft" }));
    expect(props.acts.onDraft).toHaveBeenCalledWith("rb1");
  });

  it("puts Queue on the card off the clock, with the queue order, and the header names the pick", async () => {
    const user = userEvent.setup();
    const onQueueToggle = vi.fn();
    renderCard({
      view: advisorView({ onTheClock: false, pickNumber: 17, picksUntilYourTurn: 11 }),
      acts: { canDraft: false, submitting: false, queueOrder: new Map([["rb1", 2]]), onDraft: vi.fn(), onQueueToggle },
    });
    expect(screen.getByTestId("advisor-header")).toHaveTextContent("Your next pick is 2.07, 11 picks away");
    expect(screen.getByText("still there at 2.10")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Draft" })).toBeNull();
    const queued = screen.getByRole("button", { name: "Queued 2" });
    expect(queued).toHaveAttribute("aria-pressed", "true");
    await user.click(queued);
    expect(onQueueToggle).toHaveBeenCalledWith("rb1");
  });

  it("says when there is no next pick to wait for, shows the recomputing state, and the empty line with no pick", () => {
    renderCard({ view: advisorView({ odds: null, pick: nextPick({ makeItBack: null }) }), recomputing: true });
    expect(screen.getByText("Your last turn, so nothing to wait for.")).toBeInTheDocument();
    expect(screen.getByTestId("advisor-recomputing")).toHaveAttribute("data-active", "true");
    renderCard({ view: advisorView({ pick: null }), player: null });
    expect(screen.getByText("Nothing on the board fits your roster right now.")).toBeInTheDocument();
    // The slot stays in the flow while idle (hidden, not removed), so the stamp never shifts
    // when a recompute begins — the card does not resize.
    const idle = screen.getAllByTestId("advisor-recomputing").at(-1)!;
    expect(idle).toHaveAttribute("data-active", "false");
    expect(idle).toHaveAttribute("aria-hidden", "true");
  });
});
