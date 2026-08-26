import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { MockSetupForm } from "./mock-setup-form";

const CREATED = { leagueId: "l1", teamId: "t1", draftId: "d1", shareCode: "ABC123", startsAt: "2026-08-25T12:00:00.000Z" };

function renderForm(onCreated = vi.fn(), response: unknown = { ok: true, data: CREATED }) {
  const fixture = fixtureLeagueDeps(response);
  // Records each POST body as parsed JSON, indexed the same way `fixture.calls` is — the
  // fixture itself only records the method+url, never the body, so this test file spies on the
  // one `fetchJson` call the form ever makes rather than growing the shared fixture's contract
  // for a single consumer.
  const bodies: unknown[] = [];
  const fetchJson = vi.spyOn(fixture.deps, "fetchJson");
  fetchJson.mockImplementation(async (url, init) => {
    fixture.calls.push(`${init?.method ?? "GET"} ${url}`);
    if (typeof init?.body === "string") bodies.push(JSON.parse(init.body));
    return { json: async () => fixture.response } as unknown as Response;
  });
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
  return { ...utils, fixture, bodies, onCreated };
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

  describe("Draft position — founder directive 2026-08-26", () => {
    it("defaults to Random and offers one 'Pick Nth' option per CURRENTLY selected team count", () => {
      renderForm();
      expect(screen.getByLabelText("Draft position")).toHaveValue("");
      expect(screen.getByRole("option", { name: "Random" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Pick 1st" })).toBeInTheDocument();
      expect(screen.getByRole("option", { name: "Pick 12th" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "Pick 13th" })).not.toBeInTheDocument();
    });

    it("shrinks its options when Teams shrinks", () => {
      renderForm();
      fireEvent.change(screen.getByLabelText("Teams"), { target: { value: "8" } });
      expect(screen.getByRole("option", { name: "Pick 8th" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "Pick 9th" })).not.toBeInTheDocument();
    });

    it("resets to Random when Teams shrinks below the chosen slot", () => {
      renderForm();
      fireEvent.change(screen.getByLabelText("Draft position"), { target: { value: "10" } });
      fireEvent.change(screen.getByLabelText("Teams"), { target: { value: "8" } });
      expect(screen.getByLabelText("Draft position")).toHaveValue("");
    });

    it("keeps the chosen slot when Teams shrinks but the slot still fits", () => {
      renderForm();
      fireEvent.change(screen.getByLabelText("Draft position"), { target: { value: "5" } });
      fireEvent.change(screen.getByLabelText("Teams"), { target: { value: "8" } });
      expect(screen.getByLabelText("Draft position")).toHaveValue("5");
    });

    it("posts draftSlot only when a real slot is chosen, never for Random", async () => {
      const onCreated = vi.fn();
      const { bodies } = renderForm(onCreated);
      fireEvent.click(screen.getByRole("button", { name: "Start mock draft" }));
      // Waits for the round trip to fully settle (`submitting` back to false) before the second
      // click, the same "the button re-enables" assumption the pre-existing submit test relies
      // on via `onCreated`.
      await vi.waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
      expect(bodies[0]).not.toHaveProperty("draftSlot");

      fireEvent.change(screen.getByLabelText("Draft position"), { target: { value: "7" } });
      fireEvent.click(screen.getByRole("button", { name: "Start mock draft" }));
      await vi.waitFor(() => expect(onCreated).toHaveBeenCalledTimes(2));
      expect(bodies[1]).toMatchObject({ draftSlot: 7 });
    });

    it("Randomize rolls a slot in range and sets the select to it, deterministically under a stubbed Math.random", () => {
      renderForm();
      // teamCount defaults to 12 (`defaultTeamCount` prop): floor(0.5 * 12) + 1 = 7.
      const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
      fireEvent.click(screen.getByRole("button", { name: "Randomize" }));
      expect(screen.getByLabelText("Draft position")).toHaveValue("7");
      random.mockRestore();
    });

    it("Randomize is a ghost, sentence-case control and never a second ink action", () => {
      renderForm();
      const randomizeButton = screen.getByRole("button", { name: "Randomize" });
      expect(randomizeButton.className).not.toContain("bg-text-primary");
      expect(screen.getByRole("button", { name: "Start mock draft" }).className).toContain("bg-text-primary");
    });
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
