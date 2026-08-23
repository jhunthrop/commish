import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { LEAGUE_EXPERIENCE_TIER_HINT, LEAGUE_EXPERIENCE_TIER_LABEL } from "@/identity/config";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
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
        expect(screen.getByText(/Advanced settings/)).toBeInTheDocument();
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
      ...fixture.deps,
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
    fixture.deps = { ...fixture.deps, fetchJson: () => new Promise(() => {}) };
    renderInLeague(<CreateLeagueForm onCreated={vi.fn()} />, fixture.deps);
    fireEvent.change(screen.getByLabelText("League name"), { target: { value: "Sunday Money" } });
    fireEvent.click(screen.getByRole("button", { name: "Create league" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create league" })).toBeDisabled());
  });

  it("sends the visibility and stake-tier choices, and says plainly that no money changes hands", async () => {
    const fixture = fixtureLeagueDeps({ ok: true, data: { leagueId: "l1", teamId: "t1", draftId: "d1" } });
    const bodies: unknown[] = [];
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return { json: async () => fixture.response } as unknown as Response;
      },
    };
    renderInLeague(<CreateLeagueForm onCreated={vi.fn()} />, fixture.deps);
    fireEvent.change(screen.getByLabelText("League name"), { target: { value: "Open Room" } });
    fireEvent.change(screen.getByLabelText("Who can join"), { target: { value: "public" } });
    fireEvent.change(screen.getByLabelText("Stake tier"), { target: { value: "2" } });
    expect(screen.getByText(MATCHMAKING_CONFIG.stakeDisclosure)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create league" }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ visibility: "public", stakeTier: 2 });
  });

  /**
   * FINAL REVIEW ROUND 2, R2 — the control the battery proved was missing. `createLeague` refuses a
   * veteran opening a PUBLIC league declared `beginner` and tells them "Open it to everyone
   * instead", and this form had no control that could do that: a veteran could not create a public
   * league through the UI at all, and the refusal named a remedy nobody could reach.
   */
  describe("who the league is for", () => {
    function recordingFixture() {
      const fixture = fixtureLeagueDeps({ ok: true, data: { leagueId: "l1", teamId: "t1", draftId: "d1" } });
      const bodies: unknown[] = [];
      fixture.deps = {
        ...fixture.deps,
        fetchJson: async (_url, init) => {
          bodies.push(JSON.parse(String(init?.body)));
          return { json: async () => fixture.response } as unknown as Response;
        },
      };
      return { fixture, bodies };
    }

    it("offers the open choice FIRST and defaults to it, so the default never reaches the creation gate's refusal", () => {
      const fixture = fixtureLeagueDeps();
      renderInLeague(<CreateLeagueForm onCreated={vi.fn()} />, fixture.deps);
      const select = screen.getByLabelText("Who it's for") as HTMLSelectElement;
      expect(select.value).toBe("experienced");
      // Order is the control's own promise (`EXPERIENCE_TIERS`' docblock), pinned rather than
      // assumed: `Object.entries` preserves insertion order, and the map is written open-first on
      // purpose so the safe choice is the one a commissioner lands on.
      expect([...select.options].map((option) => option.value)).toEqual(["experienced", "beginner"]);
      expect([...select.options].map((option) => option.textContent)).toEqual([
        LEAGUE_EXPERIENCE_TIER_LABEL.experienced,
        LEAGUE_EXPERIENCE_TIER_LABEL.beginner,
      ]);
      expect(screen.getByText(LEAGUE_EXPERIENCE_TIER_HINT)).toBeInTheDocument();
    });

    it("sends the default designation with a name-only creation", async () => {
      const { fixture, bodies } = recordingFixture();
      renderInLeague(<CreateLeagueForm onCreated={vi.fn()} />, fixture.deps);
      fireEvent.change(screen.getByLabelText("League name"), { target: { value: "Open Room" } });
      fireEvent.click(screen.getByRole("button", { name: "Create league" }));
      await waitFor(() => expect(bodies).toHaveLength(1));
      expect(bodies[0]).toMatchObject({ experienceTier: "experienced" });
    });

    it("sends the reserved designation when a commissioner chooses it on purpose", async () => {
      const { fixture, bodies } = recordingFixture();
      renderInLeague(<CreateLeagueForm onCreated={vi.fn()} />, fixture.deps);
      fireEvent.change(screen.getByLabelText("League name"), { target: { value: "Rookie Room" } });
      fireEvent.change(screen.getByLabelText("Who can join"), { target: { value: "public" } });
      fireEvent.change(screen.getByLabelText("Who it's for"), { target: { value: "beginner" } });
      fireEvent.click(screen.getByRole("button", { name: "Create league" }));
      await waitFor(() => expect(bodies).toHaveLength(1));
      expect(bodies[0]).toMatchObject({ visibility: "public", experienceTier: "beginner" });
    });

    it("shows the creation gate's own refusal against the control that answers it, without losing the name", async () => {
      // The refusal now points at a control that exists — the whole reason this control shipped.
      // The literal, not `ENFORCEMENT_REFUSALS.create`: room code may not value-import a service
      // module (the client boundary, `eslint.config.mjs`). The BINDING between this sentence and the
      // constant is proven server-side, where it belongs — `src/app/api/leagues/route.test.ts`
      // asserts the route answers exactly `ENFORCEMENT_REFUSALS.create`. This proves the other half:
      // whatever the server refuses with reaches the person, beside the control that answers it.
      const refusal = "You have played enough seasons here that you can't open a league reserved for newer players. Open it to everyone instead.";
      const fixture = fixtureLeagueDeps({ ok: false, error: refusal });
      renderInLeague(<CreateLeagueForm onCreated={vi.fn()} />, fixture.deps);
      fireEvent.change(screen.getByLabelText("League name"), { target: { value: "Rookie Room" } });
      fireEvent.change(screen.getByLabelText("Who it's for"), { target: { value: "beginner" } });
      fireEvent.click(screen.getByRole("button", { name: "Create league" }));
      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(refusal));
      expect((screen.getByLabelText("League name") as HTMLInputElement).value).toBe("Rookie Room");
      // And the control that fixes it is still on screen, still holding the choice that caused it.
      expect((screen.getByLabelText("Who it's for") as HTMLSelectElement).value).toBe("beginner");
    });

    it("renders inside the open disclosure, keyboard-reachable and axe-clean in both themes, at 360px", async () => {
      const fixture = fixtureLeagueDeps();
      await inBothThemes(
        <LeagueRoomDepsProvider deps={fixture.deps}>
          <CreateLeagueForm onCreated={vi.fn()} />
        </LeagueRoomDepsProvider>,
        async ({ container }) => {
          const details = container.querySelector("details")!;
          details.setAttribute("open", "");
          const select = screen.getByLabelText("Who it's for");
          // A native `<select>` through the shared `Select` primitive: focusable, labelled, and in
          // the tab order without a `tabIndex` of its own.
          expect(select.tagName).toBe("SELECT");
          expect(select).not.toHaveAttribute("tabindex");
          select.focus();
          expect(select).toHaveFocus();
          expect(await axe(container)).toHaveNoViolations();
        },
      );
    });
  });
});
