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
});
