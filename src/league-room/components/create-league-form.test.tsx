import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { CreateLeagueForm } from "./create-league-form";
import { LeagueRoomDepsProvider } from "../hooks/deps";

describe("CreateLeagueForm", () => {
  it("shows one visible field with the advanced settings closed, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps();
    await inBothThemes(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <CreateLeagueForm onCreated={vi.fn()} />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByLabelText("League name")).toBeInTheDocument();
        expect(screen.getByRole("group")).toBeInTheDocument(); // the <details> disclosure
        expect(screen.getByText("Advanced settings")).toBeInTheDocument();
        expect(container.querySelector("details")).not.toHaveAttribute("open");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("creates a league from just a name, and reports the ids back", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { leagueId: "l1", teamId: "t1", draftId: "d1" } });
    const onCreated = vi.fn();
    renderInLeague(<CreateLeagueForm onCreated={onCreated} />, fixture.deps);
    fireEvent.change(screen.getByLabelText("League name"), { target: { value: "Sunday Money" } });
    fireEvent.click(screen.getByRole("button", { name: "Create league" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ leagueId: "l1", teamId: "t1", draftId: "d1" }));
    expect(fixture.calls).toEqual(["POST /api/leagues"]);
  });

  it("sends the advanced choices when they are opened and changed", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { leagueId: "l1", teamId: "t1", draftId: "d1" } });
    const bodies: unknown[] = [];
    fixture.deps = {
      fetchJson: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return { json: async () => fixture.response } as unknown as Response;
      },
    };
    renderInLeague(<CreateLeagueForm onCreated={vi.fn()} />, fixture.deps);
    fireEvent.change(screen.getByLabelText("League name"), { target: { value: "Auction Night" } });
    fireEvent.change(screen.getByLabelText("Draft format"), { target: { value: "auction" } });
    fireEvent.change(screen.getByLabelText("Teams"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Create league" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ name: "Auction Night", format: "auction", teamCount: 10 });
  });

  it("shows the server's reason without losing what was typed", async () => {
    const fixture = fixtureLeagueDeps({ ok: false, error: "name: Too small: expected string to have >=1 characters" });
    renderInLeague(<CreateLeagueForm onCreated={vi.fn()} />, fixture.deps);
    fireEvent.change(screen.getByLabelText("League name"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Create league" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("name:"));
    expect((screen.getByLabelText("League name") as HTMLInputElement).value).toBe("x");
  });

  it("disables the button while the request is in flight", async () => {
    const fixture = fixtureLeagueDeps();
    fixture.deps = { fetchJson: () => new Promise(() => {}) };
    renderInLeague(<CreateLeagueForm onCreated={vi.fn()} />, fixture.deps);
    fireEvent.change(screen.getByLabelText("League name"), { target: { value: "Sunday Money" } });
    fireEvent.click(screen.getByRole("button", { name: "Create league" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create league" })).toBeDisabled());
  });
});
