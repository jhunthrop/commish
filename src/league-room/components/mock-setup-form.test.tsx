import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { MockSetupForm } from "./mock-setup-form";

const CREATED = { leagueId: "l1", teamId: "t1", draftId: "d1", shareCode: "ABC123", startsAt: "2026-08-25T12:00:00.000Z" };

function renderForm(onCreated = vi.fn(), response: unknown = { ok: true, data: CREATED }) {
  const fixture = fixtureLeagueDeps(response);
  const utils = renderInLeague(
    <MockSetupForm
      modes={["solo", "lobby", "link"]}
      teamCountOptions={[8, 10, 12]}
      pickSecondsOptions={[30, 60, 90]}
      defaultTeamCount={12}
      defaultPickSeconds={60}
      onCreated={onCreated}
    />,
    fixture.deps,
  );
  return { ...utils, fixture, onCreated };
}

describe("MockSetupForm", () => {
  it("offers every mode, team count and pick clock MOCK_CONFIG names, defaulted from its own props", () => {
    renderForm();
    expect(screen.getByRole("option", { name: "Solo, play against bots" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Lobby, open for anyone to join" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Private link, invite by code" })).toBeInTheDocument();
    expect(screen.getByLabelText("Teams")).toHaveValue("12");
    expect(screen.getByLabelText("Pick clock")).toHaveValue("60");
  });

  it("reuses CreateLeagueForm's own scoring and roster shape vocabulary", () => {
    renderForm();
    expect(screen.getByRole("option", { name: "Half PPR" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "PPR (a point per catch)" })).toBeInTheDocument();
    expect(screen.getByLabelText("Roster shape")).toBeInTheDocument();
  });

  it("posts the chosen fields and hands the created room to onCreated", async () => {
    const { fixture, onCreated } = renderForm();
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "lobby" } });
    fireEvent.change(screen.getByLabelText("Teams"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Team name (optional)"), { target: { value: "Bay Bandits" } });
    fireEvent.click(screen.getByRole("button", { name: "Start mock draft" }));
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));

    expect(fixture.calls).toEqual(["POST /api/mock-drafts"]);
  });

  it("shows the server's own refusal on failure, and never calls onCreated", async () => {
    const { onCreated } = renderForm(vi.fn(), { ok: false, error: "You have started a lot of mock drafts at once. Please wait a minute and try again." });
    fireEvent.click(screen.getByRole("button", { name: "Start mock draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You have started a lot of mock drafts at once.");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("carries the ink action, and is axe-clean in both themes", async () => {
    await renderSurface(
      <MockSetupForm
        modes={["solo", "lobby", "link"]}
        teamCountOptions={[8, 10, 12]}
        pickSecondsOptions={[30, 60, 90]}
        defaultTeamCount={12}
        defaultPickSeconds={60}
        onCreated={() => {}}
      />,
      async ({ container, getByRole }) => {
        const button = getByRole("button", { name: "Start mock draft" });
        expect(button.className).toContain("bg-text-primary");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });
});
