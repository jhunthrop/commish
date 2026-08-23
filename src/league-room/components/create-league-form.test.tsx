import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { GLOSSARY } from "@/help/glossary";
import { LEAGUE_EXPERIENCE_TIER_HINT, LEAGUE_EXPERIENCE_TIER_LABEL } from "@/identity/config";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { CreateLeagueForm, DRAWER_SUMMARY, START_TRIGGER_HINT, START_TRIGGERS, VISIBILITIES, VISIBILITY_HINT } from "./create-league-form";
import { LeagueRoomDepsProvider } from "../hooks/deps";

describe("CreateLeagueForm", () => {
  /**
   * Phase 3.5, Task 9 — the promotion. `screen.getByLabelText(...).toBeVisible()`, not merely
   * `.toBeInTheDocument()`: the whole defect the gauntlet named was a control that technically
   * EXISTED, two disclosures deep, while being unreachable to a beginner who never opened
   * anything. `toBeVisible` fails for a control sitting inside a closed `<details>`, which is
   * exactly the assertion the old placement could never have passed.
   */
  it("shows who can join and who it's for without opening anything, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps();
    await inBothThemes(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <CreateLeagueForm onCreated={vi.fn()} />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByLabelText("League name")).toBeVisible();
        expect(screen.getByLabelText("Who can join")).toBeVisible();
        expect(screen.getByLabelText("Who it's for")).toBeVisible();
        expect(screen.getByRole("group")).toBeInTheDocument(); // the <details> disclosure
        expect(screen.getByText(DRAWER_SUMMARY)).toBeInTheDocument();
        expect(container.querySelector("details")).not.toHaveAttribute("open");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  /**
   * The drawer's own summary, checked against what it actually contains rather than a hand
   * count: the old summary named three of the seven fields the drawer held ("draft format, team
   * count, scoring"), silently omitting roster shape, auction budget, start trigger and stake
   * tier. A summary that under-describes its own contents is how a control becomes unfindable
   * while still technically being present.
   *
   * DERIVED, not hand-typed (fix round 1, LOW 3): the expected list comes from walking the
   * rendered drawer's own `<label>` elements, the brief's own `drawerControlLabels()`
   * pseudocode, rather than a second hardcoded list sitting beside `DRAWER_SUMMARY`'s hardcoded
   * one. Two hardcoded lists can only ever agree with EACH OTHER, never catch a drawer control
   * added without a matching summary update — this reads what the drawer actually rendered, so a
   * FUTURE eighth field with no word in the summary fails this test on its own, with no edit
   * here required.
   */
  it("names, in its own summary, every control label the drawer actually renders", () => {
    renderInLeague(<CreateLeagueForm onCreated={vi.fn()} />, fixtureLeagueDeps().deps);
    // Widened to the drawer's fullest shape first: auction budget and draft start are both
    // conditional (auction format, public visibility), and a check that never turned either
    // condition on could not catch a summary that silently dropped one of them.
    fireEvent.change(screen.getByLabelText("Draft format"), { target: { value: "auction" } });
    fireEvent.change(screen.getByLabelText("Who can join"), { target: { value: "public" } });

    const details = document.querySelector("details")!;
    const drawerControlLabels = () => [...details.querySelectorAll("label")].map((label) => label.textContent!.trim());
    // Guards against a broken query silently passing (empty list, `toContain` vacuously true for
    // every element of nothing) — the same "finds copy to sweep" shape `glossary.test.ts` and
    // `identity/config.test.ts` both already use for an identical reason.
    expect(drawerControlLabels().length).toBeGreaterThanOrEqual(7);

    const summary = screen.getByText(DRAWER_SUMMARY);
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary).toHaveTextContent(/roster shape/i);
    const summaryText = summary.textContent!.toLowerCase();
    for (const label of drawerControlLabels()) expect(summaryText).toContain(label.split(" ")[0]!.toLowerCase());
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

    /**
     * No `<details>` to open any more (Task 9's own promotion) — the whole point is that this
     * control is keyboard-reachable WITHOUT that step now, unlike the roster-shape select below,
     * which still lives in the drawer and still needs it opened first.
     */
    it("is keyboard-reachable and axe-clean in both themes, at 360px, without opening anything", async () => {
      const fixture = fixtureLeagueDeps();
      await inBothThemes(
        <LeagueRoomDepsProvider deps={fixture.deps}>
          <CreateLeagueForm onCreated={vi.fn()} />
        </LeagueRoomDepsProvider>,
        async ({ container }) => {
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

  /**
   * "Who can join" — the control that decides FIRST, and the near homonym `EXPERIENCE_TIERS`'
   * own docblock names. Both promoted out of the drawer together (Task 9); this describes what
   * makes "Who can join" its own thing rather than a rename of "Who it's for".
   */
  describe("who can join", () => {
    it("offers invite-only FIRST and defaults to it, with its own distinct hint", () => {
      renderInLeague(<CreateLeagueForm onCreated={vi.fn()} />, fixtureLeagueDeps().deps);
      const select = screen.getByLabelText("Who can join") as HTMLSelectElement;
      expect(select.value).toBe("invite_only");
      expect([...select.options].map((option) => option.value)).toEqual(VISIBILITIES.map((option) => option.value));
      expect([...select.options].map((option) => option.textContent)).toEqual(VISIBILITIES.map((option) => option.label));
      expect(screen.getByText(VISIBILITY_HINT)).toBeInTheDocument();
      // Distinct sentences, not distinct-sounding labels — the near homonymy is the defect the
      // gauntlet named, and renaming either label would only move it.
      expect(VISIBILITY_HINT).not.toBe(LEAGUE_EXPERIENCE_TIER_HINT);
    });

    it("is visible and keyboard-reachable without opening anything, axe-clean in both themes, at 360px", async () => {
      const fixture = fixtureLeagueDeps();
      await inBothThemes(
        <LeagueRoomDepsProvider deps={fixture.deps}>
          <CreateLeagueForm onCreated={vi.fn()} />
        </LeagueRoomDepsProvider>,
        async ({ container }) => {
          const select = screen.getByLabelText("Who can join");
          expect(select.tagName).toBe("SELECT");
          expect(select).not.toHaveAttribute("tabindex");
          select.focus();
          expect(select).toHaveFocus();
          expect(await axe(container)).toHaveNoViolations();
        },
      );
    });
  });

  /**
   * "Draft start" — the sit-and-go trigger's own creation-time control (Phase 3.5, Task 9).
   * PUBLIC-MATCHMADE ONLY: a private league's fill would otherwise write a time nobody pressed
   * (the same rule `createLeagueSchema`'s own refine enforces server-side), so this control does
   * not exist on screen at all until "Who can join" is set to public.
   */
  describe("when it drafts", () => {
    it("stays out of the drawer entirely for an invite-only league", () => {
      renderInLeague(<CreateLeagueForm onCreated={vi.fn()} />, fixtureLeagueDeps().deps);
      expect(screen.queryByLabelText("Draft start")).not.toBeInTheDocument();
    });

    it("appears in the drawer, defaulted to scheduled, once the league is public", () => {
      renderInLeague(<CreateLeagueForm onCreated={vi.fn()} />, fixtureLeagueDeps().deps);
      fireEvent.change(screen.getByLabelText("Who can join"), { target: { value: "public" } });
      const select = screen.getByLabelText("Draft start") as HTMLSelectElement;
      expect(select.value).toBe("scheduled");
      expect([...select.options].map((option) => option.value)).toEqual(START_TRIGGERS.map((option) => option.value));
      expect(screen.getByText(START_TRIGGER_HINT)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "What is a sit-and-go league?" })).toBeInTheDocument();
    });

    it("resets to scheduled, invisibly, if a commissioner picks it then backs out of public", () => {
      // The remedy points at something visible (the same discipline the creation-gate refusal
      // control holds): a commissioner can never be left holding `when_full` on a field they can
      // no longer see, which would otherwise surface as an unexplained refusal from a hidden field.
      renderInLeague(<CreateLeagueForm onCreated={vi.fn()} />, fixtureLeagueDeps().deps);
      fireEvent.change(screen.getByLabelText("Who can join"), { target: { value: "public" } });
      fireEvent.change(screen.getByLabelText("Draft start"), { target: { value: "when_full" } });
      fireEvent.change(screen.getByLabelText("Who can join"), { target: { value: "invite_only" } });
      expect(screen.queryByLabelText("Draft start")).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Who can join"), { target: { value: "public" } });
      expect((screen.getByLabelText("Draft start") as HTMLSelectElement).value).toBe("scheduled");
    });

    it("sends the chosen trigger, and defaults to scheduled when nothing changed it", async () => {
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
      fireEvent.change(screen.getByLabelText("League name"), { target: { value: "Sit and Go Room" } });
      fireEvent.click(screen.getByRole("button", { name: "Create league" }));
      await waitFor(() => expect(bodies).toHaveLength(1));
      expect(bodies[0]).toMatchObject({ startTrigger: "scheduled" });

      fireEvent.change(screen.getByLabelText("Who can join"), { target: { value: "public" } });
      fireEvent.change(screen.getByLabelText("Draft start"), { target: { value: "when_full" } });
      fireEvent.click(screen.getByRole("button", { name: "Create league" }));
      await waitFor(() => expect(bodies).toHaveLength(2));
      expect(bodies[1]).toMatchObject({ visibility: "public", startTrigger: "when_full" });
    });

    it("is keyboard-reachable and axe-clean inside the open drawer, in both themes, at 360px", async () => {
      const fixture = fixtureLeagueDeps();
      await inBothThemes(
        <LeagueRoomDepsProvider deps={fixture.deps}>
          <CreateLeagueForm onCreated={vi.fn()} />
        </LeagueRoomDepsProvider>,
        async ({ container }) => {
          fireEvent.change(screen.getByLabelText("Who can join"), { target: { value: "public" } });
          const details = container.querySelector("details")!;
          details.setAttribute("open", "");
          const select = screen.getByLabelText("Draft start");
          expect(select.tagName).toBe("SELECT");
          expect(select).not.toHaveAttribute("tabindex");
          select.focus();
          expect(select).toHaveFocus();
          expect(await axe(container)).toHaveNoViolations();
        },
      );
    });
  });

  /**
   * Task 1 (superflex + canon defaults). The founder-decided default flip: half-PPR leads the
   * scoring select now, and a new roster-shape control makes superflex a one-toggle choice on
   * the canonical format, never a separate browse queue (the liquidity ruling).
   */
  describe("roster shape and the half-PPR default", () => {
    it("defaults the Scoring select to Half PPR, with full PPR one option away", () => {
      renderInLeague(<CreateLeagueForm onCreated={vi.fn()} />, fixtureLeagueDeps().deps);
      const select = screen.getByLabelText("Scoring") as HTMLSelectElement;
      expect(select.value).toBe("half_ppr");
      expect([...select.options].map((option) => option.value)).toEqual(["half_ppr", "ppr", "standard", "te_premium"]);
    });

    it("offers Standard first and defaults to it, with Superflex one option away", () => {
      renderInLeague(<CreateLeagueForm onCreated={vi.fn()} />, fixtureLeagueDeps().deps);
      const select = screen.getByLabelText("Roster shape") as HTMLSelectElement;
      expect(select.value).toBe("standard");
      expect([...select.options].map((option) => option.value)).toEqual(["standard", "superflex"]);
      expect([...select.options].map((option) => option.textContent)).toEqual(["Standard", "Superflex"]);
    });

    it("sends the default roster shape with a name-only creation", async () => {
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
      fireEvent.change(screen.getByLabelText("League name"), { target: { value: "Sunday Money" } });
      fireEvent.click(screen.getByRole("button", { name: "Create league" }));
      await waitFor(() => expect(bodies).toHaveLength(1));
      expect(bodies[0]).toMatchObject({ scoringPreset: "half_ppr", rosterShape: "standard" });
    });

    it("sends the superflex toggle when a commissioner chooses it", async () => {
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
      fireEvent.change(screen.getByLabelText("League name"), { target: { value: "Two QB League" } });
      fireEvent.change(screen.getByLabelText("Roster shape"), { target: { value: "superflex" } });
      fireEvent.click(screen.getByRole("button", { name: "Create league" }));
      await waitFor(() => expect(bodies).toHaveLength(1));
      expect(bodies[0]).toMatchObject({ rosterShape: "superflex" });
    });

    it("carries an InfoTip beside the roster shape select", () => {
      renderInLeague(<CreateLeagueForm onCreated={vi.fn()} />, fixtureLeagueDeps().deps);
      expect(screen.getByRole("button", { name: "What is a superflex spot?" })).toBeInTheDocument();
    });

    it("threads helpLevel into the roster-shape InfoTip: guided shows the short line inline", () => {
      const fixture = fixtureLeagueDeps();
      const { rerender } = renderInLeague(<CreateLeagueForm onCreated={vi.fn()} />, fixture.deps);
      expect(screen.queryByText(GLOSSARY.superflex.short)).not.toBeInTheDocument();
      rerender(
        <LeagueRoomDepsProvider deps={fixture.deps}>
          <CreateLeagueForm onCreated={vi.fn()} helpLevel="guided" />
        </LeagueRoomDepsProvider>,
      );
      expect(screen.getByText(GLOSSARY.superflex.short)).toBeInTheDocument();
    });

    it("renders keyboard-reachable and axe-clean in both themes, at 360px", async () => {
      const fixture = fixtureLeagueDeps();
      await inBothThemes(
        <LeagueRoomDepsProvider deps={fixture.deps}>
          <CreateLeagueForm onCreated={vi.fn()} />
        </LeagueRoomDepsProvider>,
        async ({ container }) => {
          const details = container.querySelector("details")!;
          details.setAttribute("open", "");
          const select = screen.getByLabelText("Roster shape");
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
