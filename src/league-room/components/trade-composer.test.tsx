import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { TRADE_CONFIG } from "@/trades/config";
import type { TradeRoomContext } from "../contract";
import { TradeComposer } from "./trade-composer";

const CONTEXT: TradeRoomContext = {
  weekNumber: 5,
  myTeamId: "me",
  counterparties: [{ teamId: "them", teamName: "Iron Owls" }],
  rostersByTeamId: {
    me: [{ playerId: "p1", name: "Bijan Robinson", position: "RB" }],
    them: [{ playerId: "p2", name: "Puka Nacua", position: "WR" }],
  },
};

const ASSESSMENT_OK = {
  ok: true as const,
  data: { headline: "Close call.", reasoning: "Both sides give up similar weekly production.", degraded: false, verdict: "even" as const, flags: [], givingValue: 18, receivingValue: 17.5 },
};

function selectCounterparty() {
  fireEvent.change(screen.getByLabelText("Trade with"), { target: { value: "them" } });
}

describe("TradeComposer", () => {
  it("caps the package at the same number the service does, from the same config, in both themes, axe-clean", async () => {
    const onAssess = vi.fn();
    const onPropose = vi.fn();
    await inBothThemes(
      <TradeComposer context={CONTEXT} onAssess={onAssess} onPropose={onPropose} onDone={vi.fn()} onCancel={vi.fn()} />,
      async ({ container }) => {
        expect(screen.getByText(new RegExp(`up to ${TRADE_CONFIG.maxAssetsPerSide} players`))).toBeVisible();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("shows the counterparty's roster only once a team is chosen", () => {
    render(<TradeComposer context={CONTEXT} onAssess={vi.fn()} onPropose={vi.fn()} onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Choose a team to see their roster.")).toBeInTheDocument();
    selectCounterparty();
    expect(screen.getByText("Puka Nacua")).toBeInTheDocument();
  });

  it("calls the advisor trade route once a player is picked on each side, and renders the verdict before Send", async () => {
    const onAssess = vi.fn().mockResolvedValue(ASSESSMENT_OK);
    render(<TradeComposer context={CONTEXT} onAssess={onAssess} onPropose={vi.fn()} onDone={vi.fn()} onCancel={vi.fn()} />);

    selectCounterparty();
    fireEvent.click(screen.getByLabelText(/Bijan Robinson/));
    expect(onAssess).not.toHaveBeenCalled(); // only one side picked so far

    fireEvent.click(screen.getByLabelText(/Puka Nacua/));
    await waitFor(() => expect(onAssess).toHaveBeenCalledWith({ weekNumber: 5, counterpartyTeamId: "them", give: ["p1"], receive: ["p2"] }));
    expect(await screen.findByText(/close to even/i)).toBeInTheDocument();
  });

  it("caps a side's own picks at TRADE_CONFIG.maxAssetsPerSide", () => {
    const roster = Array.from({ length: TRADE_CONFIG.maxAssetsPerSide + 1 }, (_, index) => ({
      playerId: `p${index}`,
      name: `Player ${index}`,
      position: "WR" as const,
    }));
    const context: TradeRoomContext = { ...CONTEXT, rostersByTeamId: { ...CONTEXT.rostersByTeamId, me: roster } };
    render(<TradeComposer context={context} onAssess={vi.fn()} onPropose={vi.fn()} onDone={vi.fn()} onCancel={vi.fn()} />);

    for (let index = 0; index < TRADE_CONFIG.maxAssetsPerSide; index += 1) {
      fireEvent.click(screen.getByLabelText(new RegExp(`Player ${index}\\b`)));
    }
    expect(screen.getByLabelText(new RegExp(`Player ${TRADE_CONFIG.maxAssetsPerSide}\\b`))).toBeDisabled();
  });

  it("keeps Send disabled until both sides have at least one player", () => {
    render(<TradeComposer context={CONTEXT} onAssess={vi.fn().mockResolvedValue(ASSESSMENT_OK)} onPropose={vi.fn()} onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Propose trade" })).toBeDisabled();
    selectCounterparty();
    fireEvent.click(screen.getByLabelText(/Bijan Robinson/));
    expect(screen.getByRole("button", { name: "Propose trade" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Puka Nacua/));
    expect(screen.getByRole("button", { name: "Propose trade" })).toBeEnabled();
  });

  it("sends the counterparty team and assets, never the proposer's own identity", async () => {
    const onPropose = vi.fn().mockResolvedValue({ ok: true, data: { tradeId: "t1", verdict: { givingValue: 18, receivingValue: 15, delta: 3, verdict: "favors_receiver", flags: [] } } });
    render(<TradeComposer context={CONTEXT} onAssess={vi.fn().mockResolvedValue(ASSESSMENT_OK)} onPropose={onPropose} onDone={vi.fn()} onCancel={vi.fn()} />);

    selectCounterparty();
    fireEvent.click(screen.getByLabelText(/Bijan Robinson/));
    fireEvent.click(screen.getByLabelText(/Puka Nacua/));
    fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: "Rebuilding TE" } });
    fireEvent.click(screen.getByRole("button", { name: "Propose trade" }));

    await waitFor(() =>
      expect(onPropose).toHaveBeenCalledWith({
        counterpartyTeamId: "them",
        weekNumber: 5,
        proposerAssets: [{ kind: "player", playerId: "p1" }],
        counterpartyAssets: [{ kind: "player", playerId: "p2" }],
        note: "Rebuilding TE",
      }),
    );
    expect(Object.keys(onPropose.mock.calls[0]![0] as object)).not.toContain("proposerTeamId");
  });

  it("shows the sender's own advisory read once more after sending, then hands off on Done", async () => {
    const onPropose = vi.fn().mockResolvedValue({ ok: true, data: { tradeId: "t1", verdict: { givingValue: 18, receivingValue: 40, delta: -22, verdict: "favors_proposer", flags: [] } } });
    const onDone = vi.fn();
    render(<TradeComposer context={CONTEXT} onAssess={vi.fn().mockResolvedValue(ASSESSMENT_OK)} onPropose={onPropose} onDone={onDone} onCancel={vi.fn()} />);

    selectCounterparty();
    fireEvent.click(screen.getByLabelText(/Bijan Robinson/));
    fireEvent.click(screen.getByLabelText(/Puka Nacua/));
    fireEvent.click(screen.getByRole("button", { name: "Propose trade" }));

    expect(await screen.findByText("Trade proposed.")).toBeInTheDocument();
    expect(screen.getByText(/favors what you would get back/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalled();
  });

  // Fix round 1, F2 (HIGH, member panel): a first-timer's "what happens next?" went unanswered
  // by this screen. `TRADE_CONFIG.proposalTtlHours` is 72, so this reads "Expires in 3 days." —
  // derived from config, never a hardcoded "three".
  it("tells the sender when the offer expires and what happens if nobody answers", async () => {
    const onPropose = vi.fn().mockResolvedValue({ ok: true, data: { tradeId: "t1", verdict: { givingValue: 18, receivingValue: 17, delta: 1, verdict: "even", flags: [] } } });
    render(<TradeComposer context={CONTEXT} onAssess={vi.fn().mockResolvedValue(ASSESSMENT_OK)} onPropose={onPropose} onDone={vi.fn()} onCancel={vi.fn()} />);

    selectCounterparty();
    fireEvent.click(screen.getByLabelText(/Bijan Robinson/));
    fireEvent.click(screen.getByLabelText(/Puka Nacua/));
    fireEvent.click(screen.getByRole("button", { name: "Propose trade" }));

    expect(await screen.findByText("Trade proposed.")).toBeInTheDocument();
    expect(screen.getByText(`Expires in ${TRADE_CONFIG.proposalTtlHours / 24} days. If nobody answers by then, it expires on its own and neither roster changes.`)).toBeInTheDocument();
  });

  it("shows the server's reason when a proposal is refused", async () => {
    const onPropose = vi.fn().mockResolvedValue({ ok: false, error: "You have 10 offers out already. Withdraw one before you send another." });
    render(<TradeComposer context={CONTEXT} onAssess={vi.fn().mockResolvedValue(ASSESSMENT_OK)} onPropose={onPropose} onDone={vi.fn()} onCancel={vi.fn()} />);

    selectCounterparty();
    fireEvent.click(screen.getByLabelText(/Bijan Robinson/));
    fireEvent.click(screen.getByLabelText(/Puka Nacua/));
    fireEvent.click(screen.getByRole("button", { name: "Propose trade" }));

    expect(await screen.findByText("You have 10 offers out already. Withdraw one before you send another.")).toBeInTheDocument();
  });

  it("cancels back to the inbox without sending anything", () => {
    const onCancel = vi.fn();
    const onPropose = vi.fn();
    render(<TradeComposer context={CONTEXT} onAssess={vi.fn()} onPropose={onPropose} onDone={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onPropose).not.toHaveBeenCalled();
  });

  it("carries no em dash or en dash", () => {
    render(<TradeComposer context={CONTEXT} onAssess={vi.fn()} onPropose={vi.fn()} onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(document.body.textContent).not.toMatch(/[–—]/);
  });

  // Fix round 1, F5 (MEDIUM): the brief's own Step 2 called for the primary flow walked
  // keyboard-only, and nothing in this diff did. Mirrors `ResolutionForm`'s own fix-round-1
  // precedent (`resolution-form.test.tsx`, FIX 6) — `selectOptions` is testing-library's own
  // keyboard-equivalent for a native `<select>` (a real per-keystroke OS dropdown has no faithful
  // jsdom/happy-dom equivalent); every other control here is driven by Tab, Space and Enter, with
  // no `fireEvent.click`/`userEvent.click` anywhere in this test.
  it("walks the primary propose flow keyboard-only: choose a team, pick a player each side, send", async () => {
    const user = userEvent.setup();
    const onAssess = vi.fn().mockResolvedValue(ASSESSMENT_OK);
    const onPropose = vi.fn().mockResolvedValue({ ok: true, data: { tradeId: "t1", verdict: { givingValue: 18, receivingValue: 17.5, delta: 0.5, verdict: "even", flags: [] } } });
    render(<TradeComposer context={CONTEXT} onAssess={onAssess} onPropose={onPropose} onDone={vi.fn()} onCancel={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText("Trade with"), "them");

    await user.tab();
    expect(screen.getByLabelText(/Bijan Robinson/)).toHaveFocus();
    await user.keyboard(" ");
    expect(screen.getByLabelText(/Bijan Robinson/)).toBeChecked();

    await user.tab();
    expect(screen.getByLabelText(/Puka Nacua/)).toHaveFocus();
    await user.keyboard(" ");
    expect(screen.getByLabelText(/Puka Nacua/)).toBeChecked();

    await waitFor(() => expect(onAssess).toHaveBeenCalled());
    expect(await screen.findByText(/close to even/i)).toBeInTheDocument();

    await user.tab();
    expect(screen.getByLabelText("Note (optional)")).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Propose trade" })).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(onPropose).toHaveBeenCalled());
    expect(await screen.findByText("Trade proposed.")).toBeInTheDocument();
  });
});
