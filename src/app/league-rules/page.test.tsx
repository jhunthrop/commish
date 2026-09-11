import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { GLOSSARY } from "@/help/glossary";
import { LEAGUE_RULES_GLOSSARY_TERMS } from "./glossary-section";
import LeagueRulesPage from "./page";

// These pages read the session so their header can say "Your leagues" to somebody who already has
// some (founder, 2026-08-27), which makes them async server components. Signed out is the state
// these tests assert against; the header's other arm has its own test in `public-bar.test.tsx`.
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn(async () => null) }));

/**
 * E10 (Task 10): the seven terms this page used to hand off to an `InfoTip` click now link
 * straight down the page to their own glossary entry. These tests prove the anchor pairing holds
 * end to end (every `TermLink` href resolves to a real `id` on the same render) rather than just
 * that each piece renders in isolation.
 */
describe("LeagueRulesPage", () => {
  // Set equality, not a count: the prose names a term wherever the prose needs it, and
  // "playoffs" earns two mentions (the season chapter and the standings chapter), which a raw
  // count read as a defect. What actually has to hold is both directions — every link lands on
  // an anchor this render carries, and every term in the registry is linked at least once, so no
  // entry sits below the fold with nothing in the prose pointing at it.
  it("wires every TermLink href to a real id rendered on the same page", async () => {
    const { container } = render(await LeagueRulesPage());
    const hrefs = [...container.querySelectorAll("main a[href^='#term-']")].map((a) => a.getAttribute("href"));
    for (const href of hrefs) {
      expect(container.querySelector(href!), `no target for ${href}`).not.toBeNull();
    }
    const linked = new Set(hrefs.map((href) => href!.replace("#term-", "")));
    expect([...linked].sort()).toEqual([...LEAGUE_RULES_GLOSSARY_TERMS].sort());
  });

  it("drops InfoTip from this page's prose — no click-to-reveal trigger left on it", async () => {
    render(await LeagueRulesPage());
    expect(screen.queryByRole("button", { name: /^What is / })).not.toBeInTheDocument();
  });

  it("reads every one of the seven glossary entries in full, not behind a click", async () => {
    render(await LeagueRulesPage());
    for (const key of LEAGUE_RULES_GLOSSARY_TERMS) {
      expect(screen.getByText(GLOSSARY[key].detail)).toBeInTheDocument();
    }
  });

  it("is axe-clean", async () => {
    const { container } = render(await LeagueRulesPage());
    expect(await axe(container)).toHaveNoViolations();
  });

  // B4 (flow analysis journey J08; finding 3): opens with the plain-language definition and a
  // short season summary, before any format detail — the same sentence `FrontDoorHero` leads
  // the front door with.
  it("opens with the plain-language definition, verbatim, before the format detail", async () => {
    render(await LeagueRulesPage());
    expect(
      screen.getByText(
        "A league is a group of managers who draft NFL players, then start the ones they think will " +
          "score most each week. You play one other manager every week of the NFL season. Your team's " +
          "score is whatever your starters do in their real games.",
      ),
    ).toBeInTheDocument();
  });

  // The bridge used to open "Here is how a season goes." Once the page became chapters
  // (2026-08-28) that sentence sat directly under a heading saying the same words, which is the
  // system clearing its throat — the chapter itself is the bridge now. What the test was always
  // about survives: the season is told before any format vocabulary, and it names no week count
  // of its own, because `LEAGUE_CONFIG` owns those numbers.
  it("says how a season goes before the format detail, with no hardcoded week count", async () => {
    const { container } = render(await LeagueRulesPage());
    const season = container.querySelector("#season");
    expect(season, "no season chapter").not.toBeNull();
    expect(screen.getByRole("heading", { name: "How a season goes" })).toBeInTheDocument();
    expect(season!.compareDocumentPosition(container.querySelector("#drafts")!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(season!.textContent ?? "").not.toMatch(/\d+\s*(regular season\s*)?weeks?/i);
  });

  // B4: ends with a way forward, not a list of absences — the page still states the honest
  // limits (the previous test would fail if that paragraph vanished), it just no longer gets
  // the last word. The way forward names the people drafting rather than the category of page
  // it opens ("See open leagues", the label this pinned before 2026-08-28).
  it("ends with a way forward rather than the list of what this product cannot do yet", async () => {
    const { container } = render(await LeagueRulesPage());
    const limits = screen.getByText(/This product does not yet support a waiver wire/);
    const forward = screen.getByRole("link", { name: "See who is drafting soon" });
    expect(forward).toHaveAttribute("href", "/browse");
    expect(limits.compareDocumentPosition(forward)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(container.querySelector("#limits")?.contains(forward)).toBe(true);
  });
});
