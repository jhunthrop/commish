import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { StoryModule, type SeasonEndingStory } from "./story-module";

const STORY: SeasonEndingStory = {
  season: 2025,
  lastPlayedWeek: 9,
  firstMissedWeek: 10,
  reportStatus: "Season-ending",
  primaryInjury: "Torn ACL",
};

describe("StoryModule", () => {
  it("states the season-ending sentence with a lowercased injury and names its source", () => {
    const { container } = render(<StoryModule story={STORY} />);
    expect(container.textContent).toContain("His 2025 season ended after week 9. The report said torn ACL.");
    expect(container.textContent).toContain("Source: official weekly injury reports.");
  });

  it("renders nothing at all without a story, since the header already wears the designation pill", () => {
    const { container } = render(<StoryModule story={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(container.querySelector('[data-story="designation"]')).toBeNull();
  });

  it("follows the copy rules — no em-dash, no semicolon", () => {
    const { container } = render(<StoryModule story={STORY} />);
    expect(container.textContent).not.toMatch(/—/);
    expect(container.textContent).not.toMatch(/;/);
  });

  it("renders axe-clean in both themes", async () => {
    await renderSurface(<StoryModule story={STORY} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
