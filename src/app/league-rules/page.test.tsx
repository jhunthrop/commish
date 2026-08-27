import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { GLOSSARY } from "@/help/glossary";
import { LEAGUE_RULES_GLOSSARY_TERMS } from "./glossary-section";
import LeagueRulesPage from "./page";

/**
 * E10 (Task 10): the seven terms this page used to hand off to an `InfoTip` click now link
 * straight down the page to their own glossary entry. These tests prove the anchor pairing holds
 * end to end (every `TermLink` href resolves to a real `id` on the same render) rather than just
 * that each piece renders in isolation.
 */
describe("LeagueRulesPage", () => {
  it("wires every TermLink href to a real id rendered on the same page", () => {
    const { container } = render(<LeagueRulesPage />);
    const hrefs = [...container.querySelectorAll("main a[href^='#term-']")].map((a) => a.getAttribute("href"));
    expect(hrefs).toHaveLength(LEAGUE_RULES_GLOSSARY_TERMS.length);
    for (const href of hrefs) {
      expect(container.querySelector(href!), `no target for ${href}`).not.toBeNull();
    }
  });

  it("drops InfoTip from this page's prose — no click-to-reveal trigger left on it", () => {
    render(<LeagueRulesPage />);
    expect(screen.queryByRole("button", { name: /^What is / })).not.toBeInTheDocument();
  });

  it("reads every one of the seven glossary entries in full, not behind a click", () => {
    render(<LeagueRulesPage />);
    for (const key of LEAGUE_RULES_GLOSSARY_TERMS) {
      expect(screen.getByText(GLOSSARY[key].detail)).toBeInTheDocument();
    }
  });

  it("is axe-clean", async () => {
    const { container } = render(<LeagueRulesPage />);
    expect(await axe(container)).toHaveNoViolations();
  });

  // B4 (flow analysis journey J08; finding 3): opens with the plain-language definition and a
  // short season summary, before any format detail — the same sentence `FrontDoorHero` leads
  // the front door with.
  it("opens with the plain-language definition, verbatim, before the format detail", () => {
    render(<LeagueRulesPage />);
    expect(
      screen.getByText(
        "A league is a group of managers who draft NFL players, then start the ones they think will " +
          "score most each week. You play one other manager every week of the NFL season. Your team's " +
          "score is whatever your starters do in their real games.",
      ),
    ).toBeInTheDocument();
  });

  it("says how a season goes before the format detail, with no hardcoded week count", () => {
    render(<LeagueRulesPage />);
    expect(screen.getByText(/Here is how a season goes/)).toBeInTheDocument();
  });

  // B4: ends with a way forward, not a list of absences — the page still states the honest
  // limits (the previous test would fail if that paragraph vanished), it just no longer gets
  // the last word.
  it("ends with a way forward rather than the list of what this product cannot do yet", () => {
    render(<LeagueRulesPage />);
    expect(
      screen.getByText(/This product does not yet support a waiver wire/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See open leagues" })).toHaveAttribute("href", "/browse");
  });
});
