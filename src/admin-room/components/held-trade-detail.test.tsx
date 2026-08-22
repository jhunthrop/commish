import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { AdminRoomDepsProvider } from "../hooks/deps";
import { fixtureAdminDeps, renderInAdmin } from "../test-fixtures";
import type { ResolutionDecision } from "@/integrity/flags";
import { HeldTradeDetail, type HeldTradeSubject } from "./held-trade-detail";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

const SUBJECT: HeldTradeSubject = {
  kind: "held_trade",
  tradeId: "trade_1",
  proposerTeamName: "Team Alice",
  counterpartyTeamName: "Team Bob",
  gave: [{ playerId: "p1", name: "Star RB", position: "RB", averagePoints: 22.4 }],
  got: [{ playerId: "p2", name: "Bench WR", position: "WR", averagePoints: 3.1 }],
  valuationBasis: "The platform valued this trade the moment it was accepted.",
  fairnessGapSummary: "The two sides differ by 40 points per week, at or past the 35-point threshold that raised this flag.",
  proposerManager: { userId: "u_alice", name: "Alice", joinedAt: "2026-01-15T00:00:00.000Z", completedSeasons: 3 },
  counterpartyManager: { userId: "u_bob", name: "Bob", joinedAt: null, completedSeasons: 0 },
  noLongerHeldExplanation: null,
};

/** `flagDetailFor`'s own offered set for a trade still genuinely `held` — both decisions live.
 *  Passed explicitly by every test below that is not itself about the withheld state. */
const BOTH_DECISIONS: readonly ResolutionDecision[] = ["trade_released", "trade_blocked"];

const TRAIL = [{ eventId: "evt_1", occurredAt: "2026-08-20T00:00:00.000Z", icon: "alert-triangle" as const, headline: "The platform held this trade for a fairness review.", detail: null }];

describe("HeldTradeDetail", () => {
  it("shows both sides, the gap and basis, both managers' standing and the trail, axe-clean in both themes", async () => {
    const fixture = fixtureAdminDeps();
    await inBothThemes(
      <AdminRoomDepsProvider deps={fixture.deps}>
        <HeldTradeDetail flagId="flag_1" subject={SUBJECT} trail={TRAIL} decisions={BOTH_DECISIONS} noteMaxLength={500} />
      </AdminRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByText("Star RB")).toBeInTheDocument();
        expect(screen.getByText("Bench WR")).toBeInTheDocument();
        expect(screen.getByText(SUBJECT.fairnessGapSummary)).toBeInTheDocument();
        expect(screen.getByText(SUBJECT.valuationBasis)).toBeInTheDocument();
        expect(screen.getByText("Alice")).toBeInTheDocument();
        expect(screen.getByText("Bob")).toBeInTheDocument();
        expect(screen.getByText(/3 completed seasons/)).toBeInTheDocument();
        expect(screen.getByText("Join date unknown")).toBeInTheDocument();
        expect(screen.getByText("The platform held this trade for a fairness review.")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("renders nothing named honestly when a side is empty", () => {
    const fixture = fixtureAdminDeps();
    const emptySide: HeldTradeSubject = { ...SUBJECT, got: [] };
    renderInAdmin(<HeldTradeDetail flagId="flag_1" subject={emptySide} trail={[]} decisions={BOTH_DECISIONS} noteMaxLength={500} />, fixture.deps);
    expect(screen.getByText("Nothing named on this side.")).toBeInTheDocument();
    expect(screen.getByText("No recorded history for this flag yet.")).toBeInTheDocument();
  });

  /**
   * Final review F4. This surface used to render Release and Block whenever the flag was
   * unresolved, so a held trade superseded while its flag stayed open (the crash window
   * `closeSupersededHoldFlag` documents, arbitrarily long because the closing sweep is hand-run)
   * offered an operator two buttons that both answered 409. It now renders the state's own
   * sentence and no control at all, which is the page's standing promise applied to the one
   * subject it had never been applied to.
   */
  it("offers no decision at all, and says why, once the trade is no longer waiting on one", async () => {
    const fixture = fixtureAdminDeps();
    const superseded: HeldTradeSubject = {
      ...SUBJECT,
      noLongerHeldExplanation:
        "A different trade moved one of these players first, so there is nothing left to release or block. This flag closes on its own the next time the trade sweep runs.",
    };
    await inBothThemes(
      <AdminRoomDepsProvider deps={fixture.deps}>
        <HeldTradeDetail flagId="flag_1" subject={superseded} trail={TRAIL} decisions={[]} noteMaxLength={500} />
      </AdminRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByText(superseded.noLongerHeldExplanation!)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Release the trade" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Block the trade" })).not.toBeInTheDocument();
        // No note field either: there is no decision for a note to accompany.
        expect(screen.queryByLabelText("Your note")).not.toBeInTheDocument();
        // The trade itself, and its history, still render in full — an operator reading a closed
        // question still needs to see what the question was.
        expect(screen.getByText("Star RB")).toBeInTheDocument();
        expect(screen.getByText("The platform held this trade for a fairness review.")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("keeps release and block in a spaced row, not touching, at 360px — the only other irreversible pair in the operator product", () => {
    const fixture = fixtureAdminDeps();
    renderInAdmin(<HeldTradeDetail flagId="flag_1" subject={SUBJECT} trail={[]} decisions={BOTH_DECISIONS} noteMaxLength={500} />, fixture.deps);
    const release = screen.getByRole("button", { name: "Release the trade" });
    const row = release.parentElement!;
    expect(row).toContainElement(screen.getByRole("button", { name: "Block the trade" }));
    expect(row.className).toMatch(/\bgap-4\b/);
  });

  it("asks once before releasing, because nothing undoes it", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { flagId: "flag_1", decision: "trade_released" } });
    renderInAdmin(<HeldTradeDetail flagId="flag_1" subject={SUBJECT} trail={[]} decisions={BOTH_DECISIONS} noteMaxLength={500} />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "Release the trade" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Release this trade?");
    expect(fixture.calls).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Released."));
    expect(fixture.calls).toEqual(["POST /api/admin/flags/flag_1/resolve"]);
    expect(refresh).toHaveBeenCalled();
  });

  it("asks once before blocking, because nothing undoes it either", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { flagId: "flag_1", decision: "trade_blocked" } });
    renderInAdmin(<HeldTradeDetail flagId="flag_1" subject={SUBJECT} trail={[]} decisions={BOTH_DECISIONS} noteMaxLength={500} />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Your note"), { target: { value: "Both teams belong to one person." } });
    fireEvent.click(screen.getByRole("button", { name: "Block the trade" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Block this trade?");

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Blocked."));
    expect(fixture.calls).toEqual(["POST /api/admin/flags/flag_1/resolve"]);
  });

  it("cancels back to no dialog with nothing submitted", () => {
    const fixture = fixtureAdminDeps();
    renderInAdmin(<HeldTradeDetail flagId="flag_1" subject={SUBJECT} trail={[]} decisions={BOTH_DECISIONS} noteMaxLength={500} />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "Block the trade" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fixture.calls).toEqual([]);
  });

  it("states the failure and lets the operator try again, without pretending it worked", async () => {
    const fixture = fixtureAdminDeps({ ok: false, error: "That flag was already resolved as \"blocked\"." });
    renderInAdmin(<HeldTradeDetail flagId="flag_1" subject={SUBJECT} trail={[]} decisions={BOTH_DECISIONS} noteMaxLength={500} />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "Release the trade" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("already resolved"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // The dialog closes on failure too — a failed submission is not still "confirming".
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("walks the block flow keyboard-only: write a note, open the block confirmation, confirm", async () => {
    const user = userEvent.setup();
    const fixture = fixtureAdminDeps({ ok: true, data: { flagId: "flag_1", decision: "trade_blocked" } });
    renderInAdmin(<HeldTradeDetail flagId="flag_1" subject={SUBJECT} trail={[]} decisions={BOTH_DECISIONS} noteMaxLength={500} />, fixture.deps);

    await user.tab();
    expect(screen.getByLabelText("Your note")).toHaveFocus();
    await user.keyboard("Both teams belong to one person.");

    await user.tab();
    expect(screen.getByRole("button", { name: "Release the trade" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Block the trade" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("dialog")).toHaveTextContent("Block this trade?");
    const confirm = screen.getByRole("button", { name: "Confirm" });
    confirm.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Blocked."));
  });
});
