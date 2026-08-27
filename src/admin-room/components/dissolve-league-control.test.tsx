import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureAdminDeps, renderInAdmin } from "../test-fixtures";
import { DissolveLeagueControl } from "./dissolve-league-control";

/** `beginConfirm`'s `GET` and `submit`'s `POST` need different bodies from the same test —
 *  `fixtureAdminDeps`'s function form picks by method. */
function previewThenDissolve(preview: unknown, outcome: unknown) {
  return fixtureAdminDeps((_url: string, init: RequestInit | undefined) => ((init?.method ?? "GET") === "GET" ? preview : outcome));
}

describe("DissolveLeagueControl", () => {
  it("renders the form, in both themes, axe-clean", async () => {
    await renderSurface(<DissolveLeagueControl />, async ({ container }) => {
      expect(screen.getByLabelText("League id")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Dissolve league" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("refuses to submit an empty league id, without reaching the server at all", async () => {
    const fixture = fixtureAdminDeps();
    renderInAdmin(<DissolveLeagueControl />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "Dissolve league" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the league's id.");
    expect(fixture.calls).toEqual([]);
  });

  it("previews the league by name before asking, and Enter never fires the mutation directly", async () => {
    const fixture = previewThenDissolve(
      { ok: true, data: { leagueId: "lg_1", leagueName: "The Blitz Room", seatedCount: 8 } },
      { ok: true, data: { leagueId: "lg_1", refundedMembers: 8, totalRefundedCents: 16000 } },
    );
    renderInAdmin(<DissolveLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_1" } });
    fireEvent.submit(screen.getByLabelText("League id").closest("form")!);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Dissolve The Blitz Room?");
    expect(dialog).toHaveTextContent("refunds its 8 seated members");
    // A GET preview only — the one-way POST has not happened yet.
    expect(fixture.calls).toEqual(["GET /api/admin/leagues/lg_1/dissolve"]);

    expect(within(dialog).getByRole("button", { name: "Dissolve The Blitz Room" })).toBeInTheDocument();
  });

  it("names an empty league honestly — nobody seated, nothing refunded", async () => {
    const fixture = previewThenDissolve({ ok: true, data: { leagueId: "lg_empty", leagueName: "Ghost League", seatedCount: 0 } }, { ok: true, data: {} });
    renderInAdmin(<DissolveLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_empty" } });
    fireEvent.click(screen.getByRole("button", { name: "Dissolve league" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Nobody is seated, so nothing is refunded.");
  });

  it("dissolves only once the confirm button inside the dialog is pressed", async () => {
    const fixture = previewThenDissolve(
      { ok: true, data: { leagueId: "lg_1", leagueName: "The Blitz Room", seatedCount: 2 } },
      { ok: true, data: { leagueId: "lg_1", refundedMembers: 2, totalRefundedCents: 4000 } },
    );
    renderInAdmin(<DissolveLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Dissolve league" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Dissolve The Blitz Room" }));

    expect(await screen.findByRole("status")).toHaveTextContent("This league is dissolved. 2 member(s) were refunded $40.00 in total.");
    expect(fixture.calls).toEqual(["GET /api/admin/leagues/lg_1/dissolve", "POST /api/admin/leagues/lg_1/dissolve"]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("League id")).toHaveValue("");
  });

  it("cancels back to no dialog with nothing submitted", async () => {
    const fixture = previewThenDissolve({ ok: true, data: { leagueId: "lg_1", leagueName: "The Blitz Room", seatedCount: 2 } }, { ok: true, data: {} });
    renderInAdmin(<DissolveLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Dissolve league" }));
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fixture.calls).toEqual(["GET /api/admin/leagues/lg_1/dissolve"]);
  });

  it("shows the free-league sentence when nothing was owed", async () => {
    const fixture = previewThenDissolve(
      { ok: true, data: { leagueId: "lg_free", leagueName: "Free League", seatedCount: 3 } },
      { ok: true, data: { leagueId: "lg_free", refundedMembers: 3, totalRefundedCents: 0 } },
    );
    renderInAdmin(<DissolveLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_free" } });
    fireEvent.click(screen.getByRole("button", { name: "Dissolve league" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Dissolve Free League" }));

    expect(await screen.findByRole("status")).toHaveTextContent("This league is dissolved. 3 member(s) were notified; there was no fee to refund.");
  });

  it("shows the preview door's own refusal sentence when the league does not exist, before any dialog opens", async () => {
    const fixture = fixtureAdminDeps({ ok: false, error: "That league does not exist." });
    renderInAdmin(<DissolveLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_ghost" } });
    fireEvent.click(screen.getByRole("button", { name: "Dissolve league" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("That league does not exist.");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fixture.calls).toEqual(["GET /api/admin/leagues/lg_ghost/dissolve"]);
  });

  it("shows the server's own refusal sentence verbatim on the confirmed act, e.g. a draft already started", async () => {
    const fixture = previewThenDissolve(
      { ok: true, data: { leagueId: "lg_live", leagueName: "Live League", seatedCount: 4 } },
      { ok: false, error: "This league's draft has already started, so it cannot be dissolved." },
    );
    renderInAdmin(<DissolveLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_live" } });
    fireEvent.click(screen.getByRole("button", { name: "Dissolve league" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Dissolve Live League" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("This league's draft has already started, so it cannot be dissolved.");
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a generic connection message when the preview request throws", async () => {
    const fixture = fixtureAdminDeps();
    const throwingDeps = { ...fixture.deps, fetchJson: () => Promise.reject(new Error("network down")) };
    renderInAdmin(<DissolveLeagueControl />, throwingDeps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Dissolve league" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not reach the server. Check your connection and try again.");
  });

  it("clears a prior confirmation once the operator edits the field again", async () => {
    const fixture = previewThenDissolve(
      { ok: true, data: { leagueId: "lg_1", leagueName: "The Blitz Room", seatedCount: 1 } },
      { ok: true, data: { leagueId: "lg_1", refundedMembers: 1, totalRefundedCents: 0 } },
    );
    renderInAdmin(<DissolveLeagueControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Dissolve league" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Dissolve The Blitz Room" }));
    await screen.findByRole("status");

    fireEvent.change(screen.getByLabelText("League id"), { target: { value: "lg_2" } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
