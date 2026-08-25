import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureAdminDeps, renderInAdmin } from "../test-fixtures";
import { HoldsControl } from "./holds-control";

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

  it("releases the typed member's hold and shows the released figure", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { userId: "u_1", action: "release", amountCents: 80_00 } });
    let sentBody: unknown;
    const deps = {
      fetchJson: async (url: string, init?: RequestInit) => {
        sentBody = JSON.parse(String(init?.body));
        return fixture.deps.fetchJson(url, init);
      },
    };
    renderInAdmin(<HoldsControl />, deps);

    fireEvent.change(screen.getByLabelText("Member id"), { target: { value: "u_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Release hold" }));

    expect(await screen.findByRole("status")).toHaveTextContent("$80.00 released to the member's wallet.");
    expect(fixture.calls).toEqual(["POST /api/admin/holds/u_1"]);
    expect(sentBody).toEqual({ action: "release" });
    expect(screen.getByLabelText("Member id")).toHaveValue("");
  });

  it("confiscates through its own button and says where the money went", async () => {
    const fixture = fixtureAdminDeps({ ok: true, data: { userId: "u_2", action: "confiscate", amountCents: 44_00 } });
    let sentBody: unknown;
    const deps = {
      fetchJson: async (url: string, init?: RequestInit) => {
        sentBody = JSON.parse(String(init?.body));
        return fixture.deps.fetchJson(url, init);
      },
    };
    renderInAdmin(<HoldsControl />, deps);

    fireEvent.change(screen.getByLabelText("Member id"), { target: { value: "u_2" } });
    fireEvent.click(screen.getByRole("button", { name: "Confiscate hold" }));

    expect(await screen.findByRole("status")).toHaveTextContent("$44.00 confiscated to the platform.");
    expect(sentBody).toEqual({ action: "confiscate" });
  });

  it("shows the server's own refusal sentence verbatim, e.g. nothing held", async () => {
    const fixture = fixtureAdminDeps({ ok: false, error: "No money moved. Nothing is held for review on this account." });
    renderInAdmin(<HoldsControl />, fixture.deps);

    fireEvent.change(screen.getByLabelText("Member id"), { target: { value: "u_3" } });
    fireEvent.click(screen.getByRole("button", { name: "Release hold" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No money moved. Nothing is held for review on this account.");
  });

  it("says the server is unreachable when the request itself fails", async () => {
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
