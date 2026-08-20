import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { ActivityRow } from "@/integrity/activity-view";
import { inBothThemes } from "@/components/ui/test-utils";
import { ActivityFeed } from "./activity-feed";

const NEWEST: ActivityRow = {
  eventId: "e2",
  occurredAt: "2026-08-18T20:00:00.000Z",
  icon: "check",
  headline: "Ada Lovelace drafted Bijan Robinson.",
  detail: "Round 1, pick 3.",
};

const OLDEST: ActivityRow = {
  eventId: "e1",
  occurredAt: "2026-08-18T19:55:00.000Z",
  icon: "users",
  headline: "Ada Lovelace joined the league.",
  detail: null,
};

const rows: readonly ActivityRow[] = [NEWEST, OLDEST];

describe("ActivityFeed", () => {
  it("renders a row per activity entry, newest first, with a readable time, in both themes, axe-clean", async () => {
    await inBothThemes(<ActivityFeed rows={rows} leagueId="league_1" nextBefore={null} />, async ({ container }) => {
      const headlines = screen.getAllByText(/Ada Lovelace/).map((node) => node.textContent);
      expect(headlines).toEqual([NEWEST.headline, OLDEST.headline]);

      const times = document.querySelectorAll("time");
      expect(times).toHaveLength(2);
      expect(times[0]).toHaveAttribute("dateTime", NEWEST.occurredAt);
      // "Readable" means a locale-formatted date and time, not the raw ISO string a screen
      // reader would have to spell out digit by digit.
      expect(times[0]?.textContent).toBe(new Date(NEWEST.occurredAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));

      expect(screen.getByText(NEWEST.detail!)).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("offers a way forward from an empty feed instead of a dead end", () => {
    render(<ActivityFeed rows={[]} leagueId="league_1" nextBefore={null} />);
    expect(screen.getByText("Nothing has happened here yet.")).toBeVisible();
    expect(screen.getByRole("link", { name: "Go to the league" })).toHaveAttribute("href", "/app/leagues/league_1");
  });

  it("shows older entries through a plain link, so the history works with no JavaScript", () => {
    render(<ActivityFeed rows={rows} leagueId="league_1" nextBefore={41} />);
    expect(screen.getByRole("link", { name: "Show older" })).toHaveAttribute("href", "/app/leagues/league_1/activity?before=41");
  });

  // Task 9's own pagination contract: empty rows plus a non-null `nextBefore` means keep
  // paging, not "nothing here" — a page that came back all-filtered is not the end of the
  // chain, and the dead-end empty state (with its "Go to the league" exit, not a pager) must
  // never render over a cursor that still has somewhere to go.
  it("offers Show older, not the dead-end empty state, when a page came back all-filtered", () => {
    render(<ActivityFeed rows={[]} leagueId="league_1" nextBefore={7} />);
    expect(screen.queryByText("Nothing has happened here yet.")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show older" })).toHaveAttribute("href", "/app/leagues/league_1/activity?before=7");
  });

  it("does not render Show older once nextBefore is null", () => {
    render(<ActivityFeed rows={rows} leagueId="league_1" nextBefore={null} />);
    expect(screen.queryByRole("link", { name: "Show older" })).not.toBeInTheDocument();
  });

  it("passes an automated a11y check and reads as a list", async () => {
    const { container } = render(<ActivityFeed rows={rows} leagueId="league_1" nextBefore={null} />);
    expect(await axe(container)).toHaveNoViolations();
    expect(screen.getAllByRole("listitem")).toHaveLength(rows.length);
  });
});
