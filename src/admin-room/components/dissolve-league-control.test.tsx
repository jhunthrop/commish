import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureAdminDeps, renderInAdmin } from "../test-fixtures";
import { DissolveLeagueControl } from "./dissolve-league-control";

describe("DissolveLeagueControl", () => {
  it("renders the form, in both themes, axe-clean", async () => {
    await renderSurface(<DissolveLeagueControl />, async ({ container }) => {
      expect(screen.getByLabelText("League id")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Dissolve league" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("refuses to submit an empty league id, without reaching the server", async () => {
    const fixture = fixtureAdminDeps();
    renderInAdmin(<DissolveLeagueControl />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "Dissolve league" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the league's id.");
    expect(fixture.calls).toEqual([]);
  });

  it("dissolves the typed league and shows the refund total", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { leagueId: "lg_1", refundedMembers: 2, totalRefundedCents: 4000 } });
    renderInAdmin(<DissolveLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Dissolve league" }));

    expect(await screen.findByRole("status")).toHaveTextContent("This league is dissolved. 2 member(s) were refunded $40.00 in total.");
    expect(fixture.calls).toEqual(["POST /api/admin/leagues/lg_1/dissolve"]);
    expect(screen.getByLabelText("League id")).toHaveValue("");
  });

  it("shows the free-league sentence when nothing was owed", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { leagueId: "lg_free", refundedMembers: 3, totalRefundedCents: 0 } });
    renderInAdmin(<DissolveLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_free" } });
    fireEvent.click(screen.getByRole("button", { name: "Dissolve league" }));

    expect(await screen.findByRole("status")).toHaveTextContent("This league is dissolved. 3 member(s) were notified; there was no fee to refund.");
  });

  it("shows the empty-league sentence when nobody was seated", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { leagueId: "lg_empty", refundedMembers: 0, totalRefundedCents: 0 } });
    renderInAdmin(<DissolveLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_empty" } });
    fireEvent.click(screen.getByRole("button", { name: "Dissolve league" }));

    expect(await screen.findByRole("status")).toHaveTextContent("This league is dissolved. It had no seated members to refund.");
  });

  it("shows the server's own refusal sentence verbatim, e.g. a draft already started", async () => {
    const fixture = fixtureAdminDeps({ ok: false, error: "This league's draft has already started, so it cannot be dissolved." });
    renderInAdmin(<DissolveLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_live" } });
    fireEvent.click(screen.getByRole("button", { name: "Dissolve league" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("This league's draft has already started, so it cannot be dissolved.");
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a generic connection message when the request throws", async () => {
    const fixture = fixtureAdminDeps();
    const throwingDeps = { ...fixture.deps, fetchJson: () => Promise.reject(new Error("network down")) };
    renderInAdmin(<DissolveLeagueControl />, throwingDeps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Dissolve league" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not reach the server. Check your connection and try again.");
  });

  it("clears a prior confirmation once the operator edits the field again", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { leagueId: "lg_1", refundedMembers: 1, totalRefundedCents: 0 } });
    renderInAdmin(<DissolveLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Dissolve league" }));
    await screen.findByRole("status");

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_2" } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
