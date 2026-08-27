import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureAdminDeps, renderInAdmin } from "../test-fixtures";
import { HoldsControl } from "./holds-control";

/** `beginConfirm`'s `GET` preview and `submit`'s `POST` outcome need different bodies from the
 *  same test — `fixtureAdminDeps`'s function form picks by method. */
function previewThenAct(preview: unknown, outcome: unknown) {
  return fixtureAdminDeps((_url: string, init: RequestInit | undefined) => ((init?.method ?? "GET") === "GET" ? preview : outcome));
}

describe("HoldsControl", () => {
  it("renders the form with both one-way outcomes, in both themes, axe-clean", async () => {
    await renderSurface(<HoldsControl />, async ({ container }) => {
      expect(screen.getByLabelText("Member id")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Release hold" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Confiscate hold" })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("refuses to submit an empty member id, without reaching the server", async () => {
    const fixture = fixtureAdminDeps();
    renderInAdmin(<HoldsControl />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "Release hold" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the member's user id.");
    expect(fixture.calls).toEqual([]);
  });

  it("previews the member by name and amount before releasing, with the page's own ink on confirm", async () => {
    const fixture = previewThenAct(
      { ok: true, data: { userId: "u_1", displayName: "Alice", heldCents: 80_00 } },
      { ok: true, data: { userId: "u_1", action: "release", amountCents: 80_00 } },
    );
    renderInAdmin(<HoldsControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Member id"), { target: { value: "u_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Release hold" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Release hold for Alice?");
    expect(dialog).toHaveTextContent("Pay $80.00 to Alice's wallet.");
    expect(fixture.calls).toEqual(["GET /api/admin/holds/u_1"]);

    const confirm = within(dialog).getByRole("button", { name: "Release Alice's hold" });
    expect(confirm.className).not.toContain("bg-negative");

    fireEvent.click(confirm);
    expect(await screen.findByRole("status")).toHaveTextContent("$80.00 released to the member's wallet.");
    expect(fixture.calls).toEqual(["GET /api/admin/holds/u_1", "POST /api/admin/holds/u_1"]);
    expect(screen.getByLabelText("Member id")).toHaveValue("");
  });

  it("previews confiscate visually distinct from release, and restates that it takes the balance", async () => {
    const fixture = previewThenAct(
      { ok: true, data: { userId: "u_2", displayName: "Bob", heldCents: 44_00 } },
      { ok: true, data: { userId: "u_2", action: "confiscate", amountCents: 44_00 } },
    );
    renderInAdmin(<HoldsControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Member id"), { target: { value: "u_2" } });
    fireEvent.click(screen.getByRole("button", { name: "Confiscate hold" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Confiscate hold for Bob?");
    expect(dialog).toHaveTextContent("Take $44.00 from Bob's balance.");

    const confirm = within(dialog).getByRole("button", { name: "Confiscate Bob's hold" });
    expect(confirm.className).toContain("bg-negative");

    fireEvent.click(confirm);
    expect(await screen.findByRole("status")).toHaveTextContent("$44.00 confiscated to the platform.");
  });

  it("keeps at most one primary-ink button on screen while a confirm dialog is open (wave-1 review Q8)", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { userId: "u_1", displayName: "Alice", heldCents: 80_00 } });
    renderInAdmin(<HoldsControl />, fixture.deps);

    const primaryButtonCount = (): number =>
      screen.getAllByRole("button").filter((button) => !(button as HTMLButtonElement).disabled && button.className.includes("bg-text-primary")).length;

    // Before any dialog: "Release hold" is the page's own primary trigger.
    expect(primaryButtonCount()).toBe(1);

    fireEvent.change(screen.getByLabelText("Member id"), { target: { value: "u_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Release hold" }));
    const dialog = await screen.findByRole("dialog");

    // While confirming a RELEASE (the modal's own button is primary), the underlying "Release
    // hold" trigger has stepped down to secondary — exactly one primary button remains: the
    // modal's own.
    expect(primaryButtonCount()).toBe(1);
    expect(within(dialog).getByRole("button", { name: "Release Alice's hold" }).className).toContain("bg-text-primary");
    expect(screen.getByRole("button", { name: "Release hold" }).className).not.toContain("bg-text-primary");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // Closed: the trigger returns to its ordinary ink.
    expect(primaryButtonCount()).toBe(1);
  });

  it("leaves zero primary-ink buttons on screen while confirming a confiscate (its own confirm is destructive, not primary)", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { userId: "u_2", displayName: "Bob", heldCents: 44_00 } });
    renderInAdmin(<HoldsControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Member id"), { target: { value: "u_2" } });
    fireEvent.click(screen.getByRole("button", { name: "Confiscate hold" }));
    await screen.findByRole("dialog");

    const primaryButtons = screen
      .getAllByRole("button")
      .filter((button) => !(button as HTMLButtonElement).disabled && button.className.includes("bg-text-primary"));
    expect(primaryButtons).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Release hold" }).className).not.toContain("bg-text-primary");
  });

  it("refuses before opening a dialog when nothing is held", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { userId: "u_3", displayName: "Cara", heldCents: 0 } });
    renderInAdmin(<HoldsControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Member id"), { target: { value: "u_3" } });
    fireEvent.click(screen.getByRole("button", { name: "Release hold" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing is held for this member.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("cancels back to no dialog with nothing submitted", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { userId: "u_1", displayName: "Alice", heldCents: 80_00 } });
    renderInAdmin(<HoldsControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Member id"), { target: { value: "u_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Release hold" }));
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fixture.calls).toEqual(["GET /api/admin/holds/u_1"]);
  });

  it("shows the preview door's own refusal sentence when the member does not exist, before any dialog opens", async () => {
    const fixture = fixtureAdminDeps({ ok: false, error: "That member does not exist." });
    renderInAdmin(<HoldsControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Member id"), { target: { value: "u_ghost" } });
    fireEvent.click(screen.getByRole("button", { name: "Release hold" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That member does not exist.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the server's own refusal sentence verbatim on the confirmed act", async () => {
    const fixture = previewThenAct(
      { ok: true, data: { userId: "u_3", displayName: "Cara", heldCents: 10_00 } },
      { ok: false, error: "No money moved. Nothing is held for review on this account." },
    );
    renderInAdmin(<HoldsControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Member id"), { target: { value: "u_3" } });
    fireEvent.click(screen.getByRole("button", { name: "Release hold" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Release Cara's hold" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No money moved. Nothing is held for review on this account.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says the server is unreachable when the preview request itself fails", async () => {
    const deps = {
      fetchJson: async () => {
        throw new Error("offline");
      },
    };
    renderInAdmin(<HoldsControl />, deps);

    fireEvent.change(screen.getByLabelText("Member id"), { target: { value: "u_4" } });
    fireEvent.click(screen.getByRole("button", { name: "Confiscate hold" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("We could not reach the server. Check your connection and try again.");
  });
});
