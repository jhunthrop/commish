import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureAdminDeps, renderInAdmin } from "../test-fixtures";
import { SettleLeagueControl } from "./settle-league-control";

const PREVIEW = {
  ok: true,
  data: {
    leagueId: "lg_1",
    leagueName: "The Blitz Room",
    seasonCompleted: true,
    entryFeeCents: 20_00,
    prizeTable: [
      { place: 1, amountCents: 44_00 },
      { place: 2, amountCents: 32_00 },
    ],
    escrowCents: 80_00,
    roster: [
      { userId: "u_winner", teamName: "Team A", ownerDisplayName: "Alice" },
      { userId: "u_second", teamName: "Team B", ownerDisplayName: "Bob" },
    ],
  },
};

/** `beginConfirm`'s `GET` preview and `submit`'s `POST` outcome need different bodies from the
 *  same test — `fixtureAdminDeps`'s function form picks by method. */
function previewThenSettle(preview: unknown, outcome: unknown) {
  return fixtureAdminDeps((_url: string, init: RequestInit | undefined) => ((init?.method ?? "GET") === "GET" ? preview : outcome));
}

describe("SettleLeagueControl", () => {
  it("renders the form, in both themes, axe-clean", async () => {
    await renderSurface(<SettleLeagueControl />, async ({ container }) => {
      expect(screen.getByLabelText("League id")).toBeInTheDocument();
      expect(screen.getByLabelText("Final standings")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Settle league" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("refuses to submit an empty league id, without reaching the server", async () => {
    const fixture = fixtureAdminDeps();
    renderInAdmin(<SettleLeagueControl />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "Settle league" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the league's id.");
    expect(fixture.calls).toEqual([]);
  });

  it("previews the league's own prize table with a name beside every place, resolved from the pasted standings", async () => {
    const fixture = previewThenSettle(PREVIEW, { ok: true, data: { leagueId: "lg_1", alreadySettled: false, prizesPaidCents: 76_00, heldCents: 0, rakeCents: 4_00 } });
    renderInAdmin(<SettleLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_1" } });
    fireEvent.change(screen.getByLabelText("Final standings"), { target: { value: "u_winner\n\n  u_second  \n" } });
    fireEvent.click(screen.getByRole("button", { name: "Settle league" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Settle The Blitz Room?");
    expect(dialog).toHaveTextContent("1st: Alice (Team A)");
    expect(dialog).toHaveTextContent("$44.00");
    expect(dialog).toHaveTextContent("2nd: Bob (Team B)");
    expect(dialog).toHaveTextContent("$32.00");
    expect(dialog).toHaveTextContent("Escrow closing: $80.00.");
    // A GET preview only — the one-way POST has not happened yet.
    expect(fixture.calls).toEqual(["GET /api/admin/leagues/lg_1/settle"]);
  });

  it("flags a pasted id the league's own roster does not recognize, rather than dropping it silently", async () => {
    const fixture = fixtureAdminDeps(PREVIEW);
    renderInAdmin(<SettleLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_1" } });
    fireEvent.change(screen.getByLabelText("Final standings"), { target: { value: "u_typo" } });
    fireEvent.click(screen.getByRole("button", { name: "Settle league" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("1st: u_typo (not on this league's roster)");
  });

  it("says plainly when no standings were entered, and still shows the escrow closing", async () => {
    const fixture = fixtureAdminDeps(PREVIEW);
    renderInAdmin(<SettleLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Settle league" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("No standings were entered. No prize will be paid.");
    expect(dialog).toHaveTextContent("Escrow closing: $80.00.");
  });

  it("settles only once the confirm button inside the dialog is pressed, sending one standing per non-empty line — never an amount", async () => {
    const fixture = previewThenSettle(PREVIEW, { ok: true, data: { leagueId: "lg_1", alreadySettled: false, prizesPaidCents: 76_00, heldCents: 0, rakeCents: 4_00 } });
    let sentBody: unknown;
    const deps = {
      fetchJson: async (url: string, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "POST") sentBody = JSON.parse(String(init?.body));
        return fixture.deps.fetchJson(url, init);
      },
    };
    renderInAdmin(<SettleLeagueControl />, deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_1" } });
    fireEvent.change(screen.getByLabelText("Final standings"), { target: { value: "u_winner\n\n  u_second  \n" } });
    fireEvent.click(screen.getByRole("button", { name: "Settle league" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Settle The Blitz Room" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "This league is settled. $76.00 paid to winners, $4.00 platform fee collected. The escrow is closed at zero.",
    );
    expect(fixture.calls).toEqual(["GET /api/admin/leagues/lg_1/settle", "POST /api/admin/leagues/lg_1/settle"]);
    expect(sentBody).toEqual({
      standings: [
        { place: 1, userId: "u_winner" },
        { place: 2, userId: "u_second" },
      ],
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("League id")).toHaveValue("");
    expect(screen.getByLabelText("Final standings")).toHaveValue("");
  });

  it("states the preview's own season-completed fact and entry fee in the confirm body (wave-1 review Q7)", async () => {
    const fixture = fixtureAdminDeps(PREVIEW);
    renderInAdmin(<SettleLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Settle league" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Season complete.");
    expect(dialog).toHaveTextContent("Entry fee: $20.00.");
  });

  it("warns plainly when settling before the season is complete (wave-1 review Q7)", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { ...PREVIEW.data, seasonCompleted: false } });
    renderInAdmin(<SettleLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Settle league" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Season not yet complete. Settling now closes its escrow early.");
  });

  it("cancels back to no dialog with nothing submitted", async () => {
    const fixture = fixtureAdminDeps(PREVIEW);
    renderInAdmin(<SettleLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Settle league" }));
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fixture.calls).toEqual(["GET /api/admin/leagues/lg_1/settle"]);
  });

  it("names the held slice when a winner's payout went to review", async () => {
    const fixture = previewThenSettle(PREVIEW, { ok: true, data: { leagueId: "lg_2", alreadySettled: false, prizesPaidCents: 32_00, heldCents: 44_00, rakeCents: 4_00 } });
    renderInAdmin(<SettleLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Settle league" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Settle The Blitz Room" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "This league is settled. $32.00 paid to winners, $44.00 held for review, $4.00 platform fee collected. The escrow is closed at zero.",
    );
  });

  it("says so plainly when the league was already settled", async () => {
    const fixture = previewThenSettle(PREVIEW, { ok: true, data: { leagueId: "lg_1", alreadySettled: true, prizesPaidCents: 0, heldCents: 0, rakeCents: 0 } });
    renderInAdmin(<SettleLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Settle league" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Settle The Blitz Room" }));

    expect(await screen.findByRole("status")).toHaveTextContent("This league was already settled. No money moved.");
  });

  it("shows the preview door's own refusal sentence when the league does not exist, before any dialog opens", async () => {
    const fixture = fixtureAdminDeps({ ok: false, error: "That league does not exist." });
    renderInAdmin(<SettleLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_4" } });
    fireEvent.click(screen.getByRole("button", { name: "Settle league" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That league does not exist.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the server's own refusal sentence verbatim on the confirmed act", async () => {
    const fixture = previewThenSettle(PREVIEW, { ok: false, error: "No money moved. This league's season has not finished yet, so there is nothing to settle." });
    renderInAdmin(<SettleLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_4" } });
    fireEvent.click(screen.getByRole("button", { name: "Settle league" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Settle The Blitz Room" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No money moved. This league's season has not finished yet, so there is nothing to settle.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says the server is unreachable when the preview request itself fails", async () => {
    const deps = {
      fetchJson: async () => {
        throw new Error("offline");
      },
    };
    renderInAdmin(<SettleLeagueControl />, deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_5" } });
    fireEvent.click(screen.getByRole("button", { name: "Settle league" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not reach the server. Check your connection and try again.");
  });
});
