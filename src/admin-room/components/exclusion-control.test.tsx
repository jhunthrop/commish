import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureAdminDeps, renderInAdmin } from "../test-fixtures";
import { ExclusionControl } from "./exclusion-control";

describe("ExclusionControl", () => {
  it("renders the form, in both themes, axe-clean", async () => {
    await renderSurface(<ExclusionControl />, async ({ container }) => {
      expect(screen.getByLabelText("Member user id")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Clear self exclusion" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("refuses to submit an empty user id, without reaching the server", async () => {
    const fixture = fixtureAdminDeps();
    renderInAdmin(<ExclusionControl />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "Clear self exclusion" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the member's user id.");
    expect(fixture.calls).toEqual([]);
  });

  it("clears exclusion for the typed user id and shows the confirming sentence", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { userId: "u_member" } });
    renderInAdmin(<ExclusionControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Member user id"), { target: { value: "u_member" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear self exclusion" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Paid play is open again for this account.");
    expect(fixture.calls).toEqual(["DELETE /api/wallet/exclusion"]);
    expect(screen.getByLabelText("Member user id")).toHaveValue("");
  });

  it("shows the server's own refusal sentence verbatim, e.g. a member who is not excluded", async () => {
    const fixture = fixtureAdminDeps({ ok: false, error: '"u_member" is not a user, or is not excluded.' });
    renderInAdmin(<ExclusionControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Member user id"), { target: { value: "u_member" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear self exclusion" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent('"u_member" is not a user, or is not excluded.');
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a generic connection message when the request throws", async () => {
    const fixture = fixtureAdminDeps();
    const throwingDeps = { ...fixture.deps, fetchJson: () => Promise.reject(new Error("network down")) };
    renderInAdmin(<ExclusionControl />, throwingDeps);

    fireEvent.change(screen.getByLabelText("Member user id"), { target: { value: "u_member" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear self exclusion" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not reach the server. Check your connection and try again.");
  });

  it("clears a prior confirmation once the operator edits the field again", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { userId: "u_member" } });
    renderInAdmin(<ExclusionControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Member user id"), { target: { value: "u_member" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear self exclusion" }));
    await screen.findByRole("status");

    fireEvent.change(screen.getByLabelText("Member user id"), { target: { value: "u_other" } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
