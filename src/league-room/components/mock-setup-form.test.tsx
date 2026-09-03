import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
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

/**
 * SEGMENTS, NOT SELECTS (founder, 2026-08-28): every picker in this form is a `SegmentGroup`
 * rail — a `role="group"` of `aria-pressed` buttons — or, for the up-to-twelve-value draft
 * position, a wrap of numbered pills under its own group. These helpers speak that idiom once.
 */
const group = (name: string) => screen.getByRole("group", { name });
const pick = (groupName: string, optionName: string) =>
  fireEvent.click(within(group(groupName)).getByRole("button", { name: optionName }));
const pressed = (groupName: string) =>
  within(group(groupName))
    .getAllByRole("button")
    .find((button) => button.getAttribute("aria-pressed") === "true");

describe("MockSetupForm", () => {
  it("offers every mode, team count and pick clock MOCK_CONFIG names, defaulted from its own props", () => {
    renderForm();
    expect(within(group("Mode")).getByRole("button", { name: "Solo, play against bots" })).toBeInTheDocument();
    expect(within(group("Mode")).getByRole("button", { name: "Lobby, open for anyone to join" })).toBeInTheDocument();
    expect(within(group("Mode")).getByRole("button", { name: "Private link, invite by code" })).toBeInTheDocument();
    expect(pressed("Mode")).toHaveTextContent("Solo, play against bots");
    expect(pressed("Teams")).toHaveTextContent("12");
    expect(pressed("Pick clock")).toHaveTextContent("60s");
  });

  it("reuses CreateLeagueForm's own scoring and roster shape vocabulary", () => {
    renderForm();
    expect(within(group("Scoring")).getByRole("button", { name: "Half PPR" })).toBeInTheDocument();
    expect(within(group("Scoring")).getByRole("button", { name: "PPR (a point per catch)" })).toBeInTheDocument();
    expect(group("Roster shape")).toBeInTheDocument();
  });

  it("posts the chosen fields and hands the created room to onCreated", async () => {
    const { fixture, bodies, onCreated } = renderForm();
    pick("Mode", "Lobby, open for anyone to join");
    pick("Teams", "8");
    fireEvent.change(screen.getByLabelText("Team name (optional)"), { target: { value: "Bay Bandits" } });
    fireEvent.click(screen.getByRole("button", { name: "Start mock draft" }));
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED));

    expect(fixture.calls).toEqual(["POST /api/mock-drafts"]);
    expect(bodies[0]).toMatchObject({ mode: "lobby", teamCount: 8, teamName: "Bay Bandits" });
  });

  it("gets a measure — the form column is not the full-bleed page (E2)", () => {
    const { container } = renderForm();
    expect(container.querySelector("form")?.className).toContain("max-w-2xl");
  });

  it("groups its fields under Room, Rules and You, in that order (E2)", () => {
    renderForm();
    const eyebrows = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(eyebrows).toEqual(["Room", "Rules", "You"]);
  });

  it("keeps the submit button a pill, not a bar the width of the form column (E1)", () => {
    renderForm();
    expect(screen.getByRole("button", { name: "Start mock draft" }).className).toContain("self-start");
  });

  describe("Draft position — founder directive 2026-08-26", () => {
    it("defaults to Random and offers one numbered pill per CURRENTLY selected team count", () => {
      renderForm();
      const position = group("Draft position");
      expect(within(position).getByRole("button", { name: "Random" })).toHaveAttribute("aria-pressed", "true");
      expect(within(position).getByRole("button", { name: "1" })).toBeInTheDocument();
      expect(within(position).getByRole("button", { name: "12" })).toBeInTheDocument();
      expect(within(position).queryByRole("button", { name: "13" })).not.toBeInTheDocument();
    });

    it("shrinks its options when Teams shrinks", () => {
      renderForm();
      pick("Teams", "8");
      expect(within(group("Draft position")).getByRole("button", { name: "8" })).toBeInTheDocument();
      expect(within(group("Draft position")).queryByRole("button", { name: "9" })).not.toBeInTheDocument();
    });

    it("resets to Random when Teams shrinks below the chosen slot", () => {
      renderForm();
      pick("Draft position", "10");
      pick("Teams", "8");
      expect(pressed("Draft position")).toHaveTextContent("Random");
    });

    it("keeps the chosen slot when Teams shrinks but the slot still fits", () => {
      renderForm();
      pick("Draft position", "5");
      pick("Teams", "8");
      expect(pressed("Draft position")).toHaveTextContent("5");
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

      pick("Draft position", "7");
      fireEvent.click(screen.getByRole("button", { name: "Start mock draft" }));
      await vi.waitFor(() => expect(onCreated).toHaveBeenCalledTimes(2));
      expect(bodies[1]).toMatchObject({ draftSlot: 7 });
    });

    it("Roll it draws a slot in range and presses its pill, deterministically under a stubbed Math.random", () => {
      renderForm();
      // teamCount defaults to 12 (`defaultTeamCount` prop): floor(0.5 * 12) + 1 = 7.
      const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
      fireEvent.click(screen.getByRole("button", { name: "Roll it" }));
      expect(pressed("Draft position")).toHaveTextContent("7");
      random.mockRestore();
    });

    it("Roll it is a ghost, sentence-case control and never a second loud action", () => {
      renderForm();
      const rollButton = screen.getByRole("button", { name: "Roll it" });
      expect(rollButton.className).not.toContain("bg-accent");
      expect(rollButton.className).not.toContain("bg-text-primary");
      // The form's one loud action is the amber verb submit (law 5's budget).
      expect(screen.getByRole("button", { name: "Start mock draft" }).className).toContain("bg-accent");
    });

    it("size-matches Roll it to the pill row it sits inside (E3's old sm/40px mismatch stays dead)", () => {
      renderForm();
      expect(screen.getByRole("button", { name: "Roll it" }).className).toContain("min-h-9");
    });

    it("announces the drawn option's own label politely, for a screen-reader user (E3)", () => {
      const { container } = renderForm();
      const live = container.querySelector('span[aria-live="polite"]');
      expect(live).not.toBeNull();
      // Nothing announced before a roll happens.
      expect(live).toHaveTextContent("");

      const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
      fireEvent.click(screen.getByRole("button", { name: "Roll it" }));
      expect(live).toHaveTextContent("Pick 7th");
      random.mockRestore();
    });
  });

  it("shows the server's own refusal on failure, and never calls onCreated", async () => {
    const { onCreated } = renderForm(vi.fn(), { ok: false, error: "You have started a lot of mock drafts at once. Please wait a minute and try again." });
    fireEvent.click(screen.getByRole("button", { name: "Start mock draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You have started a lot of mock drafts at once.");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("carries the amber verb as its one loud action, and is axe-clean in both themes", async () => {
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
        // `verb`, not the old ink pill: the submit wears law 4's amber act channel.
        expect(button.className).toContain("bg-accent");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });
});
