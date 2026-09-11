import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { Position } from "@/domain/player";
import { contrastRatio } from "@/design/test-support";
import { TOKENS, type ThemeName } from "@/design/tokens";
import { renderSurface } from "@/components/ui/test-utils";
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
    await renderSurface(
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
    await renderSurface(
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
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Release this trade?");
    expect(fixture.calls).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Release the trade" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Released."));
    expect(fixture.calls).toEqual(["POST /api/admin/flags/flag_1/resolve"]);
    expect(refresh).toHaveBeenCalled();
  });

  it("asks once before blocking, because nothing undoes it either", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { flagId: "flag_1", decision: "trade_blocked" } });
    renderInAdmin(<HeldTradeDetail flagId="flag_1" subject={SUBJECT} trail={[]} decisions={BOTH_DECISIONS} noteMaxLength={500} />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Your note"), { target: { value: "Both teams belong to one person." } });
    fireEvent.click(screen.getByRole("button", { name: "Block the trade" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Block this trade?");

    fireEvent.click(within(dialog).getByRole("button", { name: "Block the trade" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Blocked."));
    expect(fixture.calls).toEqual(["POST /api/admin/flags/flag_1/resolve"]);
  });

  it("keeps at most one primary-ink button on screen while a confirm dialog is open (wave-1 review Q8)", async () => {
    const fixture = fixtureAdminDeps();
    renderInAdmin(<HeldTradeDetail flagId="flag_1" subject={SUBJECT} trail={[]} decisions={BOTH_DECISIONS} noteMaxLength={500} />, fixture.deps);

    const primaryButtonCount = (): number =>
      screen.getAllByRole("button").filter((button) => !(button as HTMLButtonElement).disabled && button.className.includes("bg-accent")).length;

    // Before any dialog: "Release the trade" is the page's own primary trigger.
    expect(primaryButtonCount()).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Release the trade" }));
    await screen.findByRole("dialog");
    // While confirming a RELEASE (the modal's own confirm is primary), the underlying trigger has
    // stepped down to secondary — exactly one primary button remains: the modal's own.
    expect(primaryButtonCount()).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // Closed: the trigger returns to its ordinary ink.
    expect(primaryButtonCount()).toBe(1);
  });

  it("leaves zero primary-ink buttons on screen while confirming a block (its own confirm is destructive, not primary)", async () => {
    const fixture = fixtureAdminDeps();
    renderInAdmin(<HeldTradeDetail flagId="flag_1" subject={SUBJECT} trail={[]} decisions={BOTH_DECISIONS} noteMaxLength={500} />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "Block the trade" }));
    await screen.findByRole("dialog");

    const primaryButtons = screen
      .getAllByRole("button")
      .filter((button) => !(button as HTMLButtonElement).disabled && button.className.includes("bg-accent"));
    expect(primaryButtons).toHaveLength(0);
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
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Release the trade" }));

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

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Block this trade?");
    const confirm = within(dialog).getByRole("button", { name: "Block the trade" });
    confirm.focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Blocked."));
  });

  /**
   * D2 (operator review, 2026-08-27) found `TradedPlayerList`'s `pts/wk` caption carrying
   * `text-text-muted` — a page-ground role — inside a `Sticker`'s own saturated fill, measuring
   * 1.07:1 in dark and 1.15:1 in light (both on QB), well under WCAG's floor. The FIRST fix
   * (opacity-blending the sticker's own on-fill role) only ever cleared a 3:1 UI-boundary floor.
   * Wave-1 review B1 corrected that: at 12px this caption IS AA body text, not a UI boundary, so
   * the floor is 4.5:1, and the caption renders the sticker's own on-fill role
   * (`positionOnFillTextClass`, `@/components/ui/position-badge`) at FULL strength — set apart
   * from the name beside it by size and weight alone, never by dimming the color. Proven here for
   * every position, both themes, against the ACTUAL rendered contrast rather than the un-blended
   * token pair `tokens.test.ts` already checks (`PositionColor.stickerText` alone).
   */
  const ALL_POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const THEMES: readonly ThemeName[] = ["dark", "light"];

  it.each(THEMES.flatMap((theme) => ALL_POSITIONS.map((position) => ({ theme, position }))))(
    "keeps the pts/wk caption at or above 4.5:1 against its own sticker fill — $theme $position",
    ({ theme, position }) => {
      const { sticker, stickerText } = TOKENS.position[theme][position.toLowerCase() as Lowercase<Position>];
      expect(contrastRatio(stickerText, sticker)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
