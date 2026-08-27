import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureAdminDeps, renderInAdmin } from "../test-fixtures";
import { ExclusionControl } from "./exclusion-control";

/** `beginConfirm`'s `GET` preview and `submit`'s `DELETE` outcome need different bodies from the
 *  same test — `fixtureAdminDeps`'s function form picks by method. */
function previewThenClear(preview: unknown, outcome: unknown) {
  return fixtureAdminDeps((_url: string, init: RequestInit | undefined) => ((init?.method ?? "GET") === "GET" ? preview : outcome));
}

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

  it("previews the member by name and exclusion date before asking, then clears only on confirm", async () => {
    const fixture = previewThenClear(
      { ok: true, data: { userId: "u_member", displayName: "Dana", selfExcludedAt: "2026-05-01T00:00:00.000Z" } },
      { ok: true, data: { userId: "u_member" } },
    );
    renderInAdmin(<ExclusionControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Member user id"), { target: { value: "u_member" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear self exclusion" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Clear self exclusion for Dana?");
    expect(dialog).toHaveTextContent("Paid play opens again for Dana, excluded since");
    expect(fixture.calls).toEqual(["GET /api/wallet/exclusion?userId=u_member"]);

    fireEvent.click(within(dialog).getByRole("button", { name: "Clear exclusion for Dana" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Paid play is open again for this account.");
    expect(fixture.calls).toEqual(["GET /api/wallet/exclusion?userId=u_member", "DELETE /api/wallet/exclusion"]);
    expect(screen.getByLabelText("Member user id")).toHaveValue("");
  });

  it("cancels back to no dialog with nothing submitted", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { userId: "u_member", displayName: "Dana", selfExcludedAt: "2026-05-01T00:00:00.000Z" } });
    renderInAdmin(<ExclusionControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Member user id"), { target: { value: "u_member" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear self exclusion" }));
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fixture.calls).toEqual(["GET /api/wallet/exclusion?userId=u_member"]);
  });

  it("shows the preview door's own refusal sentence verbatim, e.g. a member who is not excluded", async () => {
    const fixture = fixtureAdminDeps({ ok: false, error: '"u_member" is not a user, or is not excluded.' });
    renderInAdmin(<ExclusionControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Member user id"), { target: { value: "u_member" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear self exclusion" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent('"u_member" is not a user, or is not excluded.');
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a generic connection message when the preview request throws", async () => {
    const fixture = fixtureAdminDeps();
    const throwingDeps = { ...fixture.deps, fetchJson: () => Promise.reject(new Error("network down")) };
    renderInAdmin(<ExclusionControl />, throwingDeps);

    fireEvent.change(screen.getByLabelText("Member user id"), { target: { value: "u_member" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear self exclusion" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not reach the server. Check your connection and try again.");
  });

  it("clears a prior confirmation once the operator edits the field again", async () => {
    const fixture = previewThenClear(
      { ok: true, data: { userId: "u_member", displayName: "Dana", selfExcludedAt: "2026-05-01T00:00:00.000Z" } },
      { ok: true, data: { userId: "u_member" } },
    );
    renderInAdmin(<ExclusionControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Member user id"), { target: { value: "u_member" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear self exclusion" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear exclusion for Dana" }));
    await screen.findByRole("status");

    fireEvent.change(screen.getByLabelText("Member user id"), { target: { value: "u_other" } });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
