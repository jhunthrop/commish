import { describe, it, expect } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { SlotPreferenceView } from "../contract";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { LeagueRoomDepsProvider } from "../hooks/deps";
import { SLOT_PREFERENCE_EXPLAINER, SlotPreferencePanel } from "./slot-preference-panel";

const EMPTY: SlotPreferenceView = { slotCount: 12, ranking: [], assignedSlot: null, canEdit: true };
const PARTIAL: SlotPreferenceView = { slotCount: 3, ranking: [2, 1], assignedSlot: null, canEdit: true };

describe("SlotPreferencePanel", () => {
  it("renders the worked-example explainer and an editable empty state, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps();
    await renderSurface(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <SlotPreferencePanel leagueId="league_1" initialPreference={EMPTY} />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByText(SLOT_PREFERENCE_EXPLAINER)).toBeInTheDocument();
        expect(screen.getByText(/You have not ranked any slots, and that is fine/)).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("offers every one of the league's slots to add, when nothing is ranked yet", () => {
    renderInLeague(<SlotPreferencePanel leagueId="league_1" initialPreference={{ ...EMPTY, slotCount: 3 }} />, fixtureLeagueDeps().deps);
    expect(screen.getByRole("button", { name: "Add slot 1 to your ranking" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add slot 2 to your ranking" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add slot 3 to your ranking" })).toBeInTheDocument();
  });

  it("adds a slot to the bottom of the ranking with a named button", () => {
    renderInLeague(<SlotPreferencePanel leagueId="league_1" initialPreference={{ ...EMPTY, slotCount: 3 }} />, fixtureLeagueDeps().deps);
    fireEvent.click(screen.getByRole("button", { name: "Add slot 2 to your ranking" }));
    const list = screen.getByRole("list", { name: "Your ranked slots" });
    expect(list).toHaveTextContent("Slot 2");
    expect(screen.queryByRole("button", { name: "Add slot 2 to your ranking" })).not.toBeInTheDocument();
  });

  it("reorders and removes from the ranking with named, keyboard-reachable buttons — position is the meaning", () => {
    renderInLeague(<SlotPreferencePanel leagueId="league_1" initialPreference={PARTIAL} />, fixtureLeagueDeps().deps);
    const list = () => screen.getByRole("list", { name: "Your ranked slots" });
    expect(list().textContent).toMatch(/Slot 2[\s\S]*Slot 1/);

    fireEvent.click(screen.getByRole("button", { name: "Move slot 1 up" }));
    expect(list().textContent).toMatch(/Slot 1[\s\S]*Slot 2/);

    fireEvent.click(screen.getByRole("button", { name: "Move slot 1 down" }));
    expect(list().textContent).toMatch(/Slot 2[\s\S]*Slot 1/);

    fireEvent.click(screen.getByRole("button", { name: "Remove slot 2 from your ranking" }));
    expect(list().textContent).not.toContain("Slot 2");
    expect(list().textContent).toContain("Slot 1");
    // The removed slot is offered again, unranked.
    expect(screen.getByRole("button", { name: "Add slot 2 to your ranking" })).toBeInTheDocument();
  });

  it("saves the ranking and says what it saved", async () => {
    const fixture = fixtureLeagueDeps();
    const calls: { url: string; body: unknown }[] = [];
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async (url, init) => {
        calls.push({ url: String(url), body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
        return { json: async () => ({ ok: true, data: { slotCount: 3, ranking: [2, 1], assignedSlot: null, canEdit: true } }) } as unknown as Response;
      },
    };
    renderInLeague(<SlotPreferencePanel leagueId="league_1" initialPreference={PARTIAL} />, fixture.deps);

    fireEvent.click(screen.getByRole("button", { name: "Save ranking" }));

    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/slot-preference"))).toBe(true));
    const put = calls.find((c) => c.url.endsWith("/slot-preference"))!;
    expect(put.body).toEqual({ ranking: [2, 1] });
    expect(await screen.findByText("Saved. You ranked: 2, then 1.")).toBeInTheDocument();
  });

  it("says what it saved even when the ranking is empty", async () => {
    const fixture = fixtureLeagueDeps();
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async () => ({ json: async () => ({ ok: true, data: { slotCount: 3, ranking: [], assignedSlot: null, canEdit: true } }) }) as unknown as Response,
    };
    renderInLeague(<SlotPreferencePanel leagueId="league_1" initialPreference={{ ...EMPTY, slotCount: 3 }} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Save ranking" }));
    expect(await screen.findByText("Saved. You did not rank any slots, and that is fine.")).toBeInTheDocument();
  });

  it("shows the server's refusal verbatim when a save is rejected", async () => {
    const fixture = fixtureLeagueDeps();
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async () => ({ json: async () => ({ ok: false, error: "This draft has already started, so the order is set." }) }) as unknown as Response,
    };
    renderInLeague(<SlotPreferencePanel leagueId="league_1" initialPreference={PARTIAL} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Save ranking" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This draft has already started, so the order is set.");
  });

  it("wraps its controls for 360px", () => {
    renderInLeague(<SlotPreferencePanel leagueId="league_1" initialPreference={PARTIAL} />, fixtureLeagueDeps().deps);
    expect(screen.getByRole("list", { name: "Your ranked slots" }).className).toMatch(/flex-wrap/);
    expect(screen.getByRole("button", { name: "Save ranking" }).parentElement!.className).toMatch(/flex-wrap/);
  });

  describe("once the draft has started", () => {
    it("says the top choice came through, in both themes, axe-clean", async () => {
      const fixture = fixtureLeagueDeps();
      await renderSurface(
        <LeagueRoomDepsProvider deps={fixture.deps}>
          <SlotPreferencePanel leagueId="league_1" initialPreference={{ slotCount: 12, ranking: [3, 1], assignedSlot: 3, canEdit: false }} />
        </LeagueRoomDepsProvider>,
        async ({ container }) => {
          expect(screen.getByText("You ranked slot 3 first and you got slot 3.")).toBeInTheDocument();
          expect(await axe(container)).toHaveNoViolations();
        },
      );
    });

    it("says the top choice went to another manager", () => {
      renderInLeague(
        <SlotPreferencePanel leagueId="league_1" initialPreference={{ slotCount: 12, ranking: [3, 1], assignedSlot: 7, canEdit: false }} />,
        fixtureLeagueDeps().deps,
      );
      expect(screen.getByText("Slot 3 went to another manager, so you got slot 7.")).toBeInTheDocument();
    });

    it("says a random slot was drawn for a manager who never ranked anything", () => {
      renderInLeague(
        <SlotPreferencePanel leagueId="league_1" initialPreference={{ slotCount: 12, ranking: [], assignedSlot: 7, canEdit: false }} />,
        fixtureLeagueDeps().deps,
      );
      expect(screen.getByText("You did not rank a slot, so we gave you slot 7.")).toBeInTheDocument();
    });

    it("offers no editing controls once the draft has started", () => {
      renderInLeague(
        <SlotPreferencePanel leagueId="league_1" initialPreference={{ slotCount: 12, ranking: [3], assignedSlot: 3, canEdit: false }} />,
        fixtureLeagueDeps().deps,
      );
      expect(screen.queryByRole("button", { name: "Save ranking" })).not.toBeInTheDocument();
      expect(screen.queryByRole("list", { name: "Your ranked slots" })).not.toBeInTheDocument();
    });
  });

  it("walks the rank-then-save flow keyboard-only", async () => {
    const user = userEvent.setup();
    const fixture = fixtureLeagueDeps();
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async () => ({ json: async () => ({ ok: true, data: { slotCount: 2, ranking: [1], assignedSlot: null, canEdit: true } }) }) as unknown as Response,
    };
    renderInLeague(<SlotPreferencePanel leagueId="league_1" initialPreference={{ slotCount: 2, ranking: [1], assignedSlot: null, canEdit: true }} />, fixture.deps);

    await user.tab();
    expect(screen.getByRole("button", { name: "What is a draft slot?" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Move slot 1 up" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Move slot 1 down" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Remove slot 1 from your ranking" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Add slot 2 to your ranking" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Save ranking" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Saved. You ranked: 1.")).toBeInTheDocument();
  });
});
