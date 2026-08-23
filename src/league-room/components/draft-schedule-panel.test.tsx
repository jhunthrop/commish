import { describe, it, expect } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import type { DraftScheduleBody } from "../contract";
import { fixtureLeagueDeps, renderInLeague } from "../test-fixtures";
import { LeagueRoomDepsProvider } from "../hooks/deps";
import { DraftSchedulePanel } from "./draft-schedule-panel";

const SCHEDULED: DraftScheduleBody = {
  draftId: "draft_1",
  leagueId: "league_1",
  status: "scheduled",
  // A week out from whenever the suite actually runs, not a pinned fake clock: `useNow`'s
  // initial reading is `Date.now()` at mount, and mixing fake timers with `findBy*`/`waitFor`
  // (both poll on a real `setInterval` under the hood) is a known trap. Reading the real clock
  // on both sides — here, and inside `formatCountdown`/`useNow` — keeps the two in agreement
  // without mocking anything, the same way `resolution-form.test.tsx`'s own keyboard walkthrough
  // runs with no fake timers at all.
  kickoffAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  isPublicMatchmade: false,
  slotPreference: { slotCount: 12, ranking: [], assignedSlot: null, canEdit: true },
};

/** `<input type="datetime-local">` carries no timezone, so `new Date(EDITED_LOCAL_VALUE)`
 *  resolves it against whatever timezone THIS process runs in — the same conversion the
 *  panel's own `save()` performs. Deriving the expected ISO instant from that same call, rather
 *  than a hand-typed UTC literal, keeps the assertion correct in any CI timezone. */
const EDITED_LOCAL_VALUE = "2026-09-01T18:00";
const EDITED_ISO = new Date(EDITED_LOCAL_VALUE).toISOString();

describe("DraftSchedulePanel", () => {
  it("shows the scheduled time and countdown to every viewer, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps();
    await inBothThemes(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <DraftSchedulePanel leagueId="league_1" isCommissioner={false} initialSchedule={SCHEDULED} />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByText("Draft scheduled")).toBeInTheDocument();
        expect(screen.getByText(/in (6|7) days/)).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("offers no controls to a member who is not the commissioner", () => {
    renderInLeague(
      <DraftSchedulePanel leagueId="league_1" isCommissioner={false} initialSchedule={SCHEDULED} />,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getByText("Draft scheduled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start the draft" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit time" })).not.toBeInTheDocument();
  });

  it("offers edit and start controls to the commissioner, wrapped for 360px", () => {
    renderInLeague(
      <DraftSchedulePanel leagueId="league_1" isCommissioner={true} initialSchedule={SCHEDULED} />,
      fixtureLeagueDeps().deps,
    );
    const startButton = screen.getByRole("button", { name: "Start the draft" });
    const editButton = screen.getByRole("button", { name: "Edit time" });
    const row = startButton.parentElement!;
    expect(row).toContainElement(editButton);
    expect(row.className).toMatch(/flex-wrap/);
  });

  it("reads 'starting soon' once kickoff is within the hour", () => {
    const startingSoon = { ...SCHEDULED, kickoffAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() };
    renderInLeague(
      <DraftSchedulePanel leagueId="league_1" isCommissioner={false} initialSchedule={startingSoon} />,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getByText("Draft starting soon")).toBeInTheDocument();
    expect(screen.getByText(/in (29|30) minutes/)).toBeInTheDocument();
  });

  // Task 4. `SCHEDULED` (a week out) is a slow draft: once it opens it picks at a tier of an
  // hour or longer, which is exactly what the overnight freeze applies to.
  it("mentions the overnight freeze for a draft scheduled to run more than an hour out", () => {
    renderInLeague(
      <DraftSchedulePanel leagueId="league_1" isCommissioner={false} initialSchedule={SCHEDULED} />,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getByText(/pause automatically between 2:00 AM and 5:00 AM Eastern/)).toBeInTheDocument();
  });

  it("drops the overnight-freeze notice once kickoff is within the hour — that draft never reaches a slow enough tier", () => {
    const startingSoon = { ...SCHEDULED, kickoffAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() };
    renderInLeague(
      <DraftSchedulePanel leagueId="league_1" isCommissioner={false} initialSchedule={startingSoon} />,
      fixtureLeagueDeps().deps,
    );
    expect(screen.queryByText(/pause automatically/)).not.toBeInTheDocument();
  });

  it("says nothing about the overnight freeze once the draft is live or complete", async () => {
    const fixture = fixtureLeagueDeps();
    const { rerender } = renderInLeague(
      <DraftSchedulePanel leagueId="league_1" isCommissioner={false} initialSchedule={{ ...SCHEDULED, status: "in_progress" }} />,
      fixture.deps,
    );
    expect(screen.queryByText(/pause automatically/)).not.toBeInTheDocument();
    rerender(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <DraftSchedulePanel leagueId="league_1" isCommissioner={false} initialSchedule={{ ...SCHEDULED, status: "complete" }} />
      </LeagueRoomDepsProvider>,
    );
    expect(screen.queryByText(/pause automatically/)).not.toBeInTheDocument();
  });

  it("tells everyone the platform has a fallback, only for a scheduled public league", () => {
    renderInLeague(
      <DraftSchedulePanel leagueId="league_1" isCommissioner={false} initialSchedule={{ ...SCHEDULED, isPublicMatchmade: true }} />,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getByText("If nobody starts it, we will start it at the scheduled time.")).toBeInTheDocument();
  });

  it("says nothing about a platform fallback for a private league, to a member", () => {
    renderInLeague(
      <DraftSchedulePanel leagueId="league_1" isCommissioner={false} initialSchedule={{ ...SCHEDULED, isPublicMatchmade: false }} />,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getByText("Draft scheduled")).toBeInTheDocument();
    expect(screen.queryByText(/we will start it/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing starts this automatically/)).not.toBeInTheDocument();
  });

  // Persona review, Step 4: a private league's commissioner asks the same "what happens if I do
  // nothing" question a public league's does, and the honest answer is different — nobody ever
  // presses this for them.
  it("tells the commissioner of a private league that nothing starts it automatically", () => {
    renderInLeague(
      <DraftSchedulePanel leagueId="league_1" isCommissioner={true} initialSchedule={{ ...SCHEDULED, isPublicMatchmade: false }} />,
      fixtureLeagueDeps().deps,
    );
    expect(screen.getByText("Nothing starts this automatically. Press Start the draft when everyone's ready.")).toBeInTheDocument();
  });

  it("shows a link into the room while the draft is live, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps();
    await inBothThemes(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <DraftSchedulePanel leagueId="league_1" isCommissioner={true} initialSchedule={{ ...SCHEDULED, status: "in_progress" }} />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByText("The draft is live")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Join the draft" })).toHaveAttribute("href", "/app/drafts/draft_1");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("shows a designed complete state with a link into the finished board, in both themes, axe-clean", async () => {
    const fixture = fixtureLeagueDeps();
    await inBothThemes(
      <LeagueRoomDepsProvider deps={fixture.deps}>
        <DraftSchedulePanel leagueId="league_1" isCommissioner={true} initialSchedule={{ ...SCHEDULED, status: "complete" }} />
      </LeagueRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByText("Draft complete")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "View the draft board" })).toHaveAttribute("href", "/app/drafts/draft_1");
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("saves a new time and reflects it without a page reload", async () => {
    const fixture = fixtureLeagueDeps();
    const calls: { url: string; body: unknown }[] = [];
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async (url, init) => {
        calls.push({ url: String(url), body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
        return { json: async () => ({ ok: true, data: { ...SCHEDULED, kickoffAt: EDITED_ISO } }) } as unknown as Response;
      },
    };
    renderInLeague(<DraftSchedulePanel leagueId="league_1" isCommissioner={true} initialSchedule={SCHEDULED} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Edit time" }));
    fireEvent.change(screen.getByLabelText("Draft time"), { target: { value: EDITED_LOCAL_VALUE } });
    fireEvent.click(screen.getByRole("button", { name: "Save time" }));

    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/draft-schedule") && c.body !== undefined)).toBe(true));
    const put = calls.find((c) => c.body !== undefined)!;
    expect(put.body).toEqual({ kickoffAt: EDITED_ISO });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save time" })).not.toBeInTheDocument());
  });

  it("shows the server's refusal verbatim when a save is rejected", async () => {
    const fixture = fixtureLeagueDeps();
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async () =>
        ({ json: async () => ({ ok: false, error: "This draft has already started, so its time can't change." }) }) as unknown as Response,
    };
    renderInLeague(<DraftSchedulePanel leagueId="league_1" isCommissioner={true} initialSchedule={SCHEDULED} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Edit time" }));
    fireEvent.change(screen.getByLabelText("Draft time"), { target: { value: EDITED_LOCAL_VALUE } });
    fireEvent.click(screen.getByRole("button", { name: "Save time" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This draft has already started, so its time can't change.");
  });

  it("starts the draft and switches to the live state", async () => {
    const fixture = fixtureLeagueDeps();
    const calls: string[] = [];
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async (url, init) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        return { json: async () => ({ ok: true, data: { draft: {} } }) } as unknown as Response;
      },
    };
    renderInLeague(<DraftSchedulePanel leagueId="league_1" isCommissioner={true} initialSchedule={SCHEDULED} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Start the draft" }));
    expect(await screen.findByText("The draft is live")).toBeInTheDocument();
    expect(calls).toContain("POST /api/drafts/draft_1/start");
  });

  it("shows the server's refusal verbatim when starting is rejected", async () => {
    const fixture = fixtureLeagueDeps();
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async () => ({ json: async () => ({ ok: false, error: "There are no players to draft yet." }) }) as unknown as Response,
    };
    renderInLeague(<DraftSchedulePanel leagueId="league_1" isCommissioner={true} initialSchedule={SCHEDULED} />, fixture.deps);
    fireEvent.click(screen.getByRole("button", { name: "Start the draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("There are no players to draft yet.");
  });

  it("walks the choose-time-then-start flow keyboard-only", async () => {
    const user = userEvent.setup();
    const fixture = fixtureLeagueDeps();
    fixture.deps = {
      ...fixture.deps,
      fetchJson: async (_url, init) => {
        if (init?.method === "PUT") {
          return { json: async () => ({ ok: true, data: { ...SCHEDULED, kickoffAt: EDITED_ISO } }) } as unknown as Response;
        }
        return { json: async () => ({ ok: true, data: { draft: {} } }) } as unknown as Response;
      },
    };
    renderInLeague(<DraftSchedulePanel leagueId="league_1" isCommissioner={true} initialSchedule={SCHEDULED} />, fixture.deps);
    screen.getByRole("button", { name: "Edit time" });

    await user.tab();
    expect(screen.getByRole("button", { name: "Edit time" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.getByLabelText("Draft time")).toBeInTheDocument();
    await user.tab();
    expect(screen.getByLabelText("Draft time")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Draft time"), { target: { value: EDITED_LOCAL_VALUE } });

    await user.tab();
    expect(screen.getByRole("button", { name: "Save time" })).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.queryByRole("button", { name: "Save time" })).not.toBeInTheDocument());

    await user.tab();
    await user.tab();
    expect(screen.getByRole("button", { name: "Start the draft" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("The draft is live")).toBeInTheDocument();
  });
});
