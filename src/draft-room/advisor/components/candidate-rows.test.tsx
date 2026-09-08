import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { advisorView, candidatePlayers, CANDIDATES } from "../test-view";
import type { AdvisorActs } from "./advisor-acts";
import { CandidateRows, type CandidateRowsProps } from "./candidate-rows";

function acts(over: Partial<AdvisorActs> = {}): AdvisorActs {
  return { canDraft: true, submitting: false, queueOrder: new Map(), onDraft: vi.fn(), onQueueToggle: vi.fn(), ...over };
}

function renderRows(over: Partial<CandidateRowsProps> = {}) {
  const props: CandidateRowsProps = { view: advisorView(), acts: acts(), playersById: candidatePlayers(), byeWeeks: new Map([["DAL", 7]]), count: 5, ...over };
  return { ...render(<CandidateRows {...props} />), props };
}

describe("CandidateRows", () => {
  it("lists the candidates after the lead, as many as the count less the card, each with rank, face, name, position rank, team, bye and odds as runs over runs, axe-clean", async () => {
    const { container } = renderRows();
    const rows = screen.getAllByTestId("advisor-candidate");
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.dataset.playerId)).toEqual(CANDIDATES.slice(1, 5).map((candidate) => candidate.playerId));
    const first = within(rows[0]!);
    expect(first.getByText("2")).toBeInTheDocument();
    expect(first.getByTestId("player-face-team")).toHaveAttribute("data-team", "DAL");
    expect(first.getByText("Andre Salas")).toBeInTheDocument();
    expect(first.getByText("WR4")).toBeInTheDocument();
    expect(first.getByText("DAL · Bye 7")).toBeInTheDocument();
    const odds = first.getByTestId("advisor-odds-runs");
    expect(odds).toHaveTextContent("160 of 200");
    expect(odds).toHaveAttribute("data-band", "safe");
    expect(within(rows[1]!).getByTestId("advisor-odds-runs")).toHaveAttribute("data-band", "reach");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("shows ten less the card at the widest setting and two at the narrowest", () => {
    const { unmount } = renderRows({ count: 10 });
    expect(screen.getAllByTestId("advisor-candidate")).toHaveLength(9);
    unmount();
    renderRows({ count: 3 });
    expect(screen.getAllByTestId("advisor-candidate")).toHaveLength(2);
  });

  it("puts Draft on every row on the clock, through the room's own pick path", async () => {
    const user = userEvent.setup();
    const { props } = renderRows();
    const rows = screen.getAllByTestId("advisor-candidate");
    for (const row of rows) expect(within(row).getByRole("button", { name: /^Draft / })).toBeInTheDocument();
    await user.click(within(rows[2]!).getByRole("button", { name: "Draft Devon Marsh" }));
    expect(props.acts.onDraft).toHaveBeenCalledWith("rb2");
  });

  it("puts Queue on every row off the clock, naming where a queued one sits, through the room's own queue", async () => {
    const user = userEvent.setup();
    const onQueueToggle = vi.fn();
    renderRows({ acts: acts({ canDraft: false, queueOrder: new Map([["te1", 1]]), onQueueToggle }) });
    const rows = screen.getAllByTestId("advisor-candidate");
    expect(screen.queryByRole("button", { name: /^Draft/ })).toBeNull();
    expect(within(rows[1]!).getByRole("button", { name: "Queued 1, Cole Whitfield" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(rows[0]!).getByRole("button", { name: "Queue Andre Salas" }));
    expect(onQueueToggle).toHaveBeenCalledWith("wr1");
  });

  it("leaves out a candidate the room has no player for, rather than a blank row", () => {
    const players = new Map(candidatePlayers());
    players.delete("te1");
    renderRows({ playersById: players });
    expect(screen.getAllByTestId("advisor-candidate").map((row) => row.dataset.playerId)).toEqual(["wr1", "rb2", "wr2"]);
  });
});
