import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureAdminDeps, renderInAdmin } from "../test-fixtures";
import { SettleLeagueControl } from "./settle-league-control";

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

  it("settles the typed league, sending one standing per non-empty line with the top line as 1st place — and never an amount", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { leagueId: "lg_1", alreadySettled: false, prizesPaidCents: 76_00, heldCents: 0, rakeCents: 4_00 } });
    let sentBody: unknown;
    const deps = {
      fetchJson: async (url: string, init?: RequestInit) => {
        sentBody = JSON.parse(String(init?.body));
        return fixture.deps.fetchJson(url, init);
      },
    };
    renderInAdmin(<SettleLeagueControl />, deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_1" } });
    fireEvent.change(screen.getByLabelText("Final standings"), { target: { value: "u_winner\n\n  u_second  \n" } });
    fireEvent.click(screen.getByRole("button", { name: "Settle league" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "This league is settled. $76.00 paid to winners, $4.00 platform fee collected. The escrow is closed at zero.",
    );
    expect(fixture.calls).toEqual(["POST /api/admin/leagues/lg_1/settle"]);
    expect(sentBody).toEqual({
      standings: [
        { place: 1, userId: "u_winner" },
        { place: 2, userId: "u_second" },
      ],
    });
    expect(screen.getByLabelText("League id")).toHaveValue("");
    expect(screen.getByLabelText("Final standings")).toHaveValue("");
  });

  it("names the held slice when a winner's payout went to review", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { leagueId: "lg_2", alreadySettled: false, prizesPaidCents: 32_00, heldCents: 44_00, rakeCents: 4_00 } });
    renderInAdmin(<SettleLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_2" } });
    fireEvent.click(screen.getByRole("button", { name: "Settle league" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "This league is settled. $32.00 paid to winners, $44.00 held for review, $4.00 platform fee collected. The escrow is closed at zero.",
    );
  });

  it("says so plainly when the league was already settled", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { leagueId: "lg_3", alreadySettled: true, prizesPaidCents: 0, heldCents: 0, rakeCents: 0 } });
    renderInAdmin(<SettleLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_3" } });
    fireEvent.click(screen.getByRole("button", { name: "Settle league" }));

    expect(await screen.findByRole("status")).toHaveTextContent("This league was already settled. No money moved.");
  });

  it("shows the server's own refusal sentence verbatim", async () => {
    const fixture = fixtureAdminDeps({ ok: false, error: "No money moved. This league's season has not finished yet, so there is nothing to settle." });
    renderInAdmin(<SettleLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_4" } });
    fireEvent.click(screen.getByRole("button", { name: "Settle league" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No money moved. This league's season has not finished yet, so there is nothing to settle.");
  });

  it("says the server is unreachable when the request itself fails", async () => {
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
