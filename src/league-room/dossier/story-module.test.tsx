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

  it("renders the current designation pill independently of any season-ending story", () => {
    const { container } = render(<StoryModule story={null} designation="Q" />);
    expect(container.querySelector('[data-story="designation"]')!.textContent).toBe("Q");
    expect(container.querySelector('[data-story="season-ending"]')).toBeNull();
  });

  it("renders both the pill and the story together when both are real", () => {
    const { container } = render(<StoryModule story={STORY} designation="IR" />);
    expect(container.querySelector('[data-story="designation"]')!.textContent).toBe("IR");
    expect(container.querySelector('[data-story="season-ending"]')).not.toBeNull();
  });

  it("renders nothing at all when both the story and the designation are absent", () => {
    const { container } = render(<StoryModule story={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("follows the copy rules — no em-dash, no semicolon", () => {
    const { container } = render(<StoryModule story={STORY} designation="Q" />);
    expect(container.textContent).not.toMatch(/—/);
    expect(container.textContent).not.toMatch(/;/);
  });

  it("renders axe-clean in both themes", async () => {
    await renderSurface(<StoryModule story={STORY} designation="Q" />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
