import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { PlayerFactsTrend, PlayerFactsUsage } from "@/capsules/facts";
import { RoleModule } from "./role-module";

const USAGE: PlayerFactsUsage = {
  season: 2025,
  snapShare: 0.62,
  snapShareRank: { value: 0.62, positionRank: 4, qualifierCount: 32, namedNeighbor: null },
  targetShare: null,
  targetShareRank: null,
  redZoneShare: 0.4,
  redZoneShareRank: { value: 0.4, positionRank: 2, qualifierCount: 32, namedNeighbor: "Someone Else" },
};

const MATERIAL_DECLINE: PlayerFactsTrend = {
  pointsPerGame: { priorSeason: 2024, priorValue: 18.1, recentSeason: 2025, recentValue: 14.3, delta: -3.8, material: true },
  yardsPerOpportunity: null,
  targetShare: null,
};

const MATERIAL_RISE: PlayerFactsTrend = {
  pointsPerGame: { priorSeason: 2024, priorValue: 10, recentSeason: 2025, recentValue: 15, delta: 5, material: true },
  yardsPerOpportunity: null,
  targetShare: null,
};

const NON_MATERIAL: PlayerFactsTrend = {
  pointsPerGame: { priorSeason: 2024, priorValue: 12, recentSeason: 2025, recentValue: 12.4, delta: 0.4, material: false },
  yardsPerOpportunity: null,
  targetShare: null,
};

describe("RoleModule", () => {
  it("states each share as a percent and a position rank with its qualifier count", () => {
    const { container } = render(<RoleModule position="RB" usage={USAGE} trend={null} />);
    expect(container.textContent).toContain("62% · RB4 of 32");
    expect(container.textContent).toContain("40% · RB2 of 32");
  });

  it("prints an honest 'not tracked for him' for a share the store never carried", () => {
    const { container } = render(<RoleModule position="RB" usage={USAGE} trend={null} />);
    const targetRow = container.querySelector('[data-role-share="target"]')!;
    expect(targetRow.textContent).toContain("not tracked for him");
  });

  it("treats a wholly absent usage season the same as every share being untracked", () => {
    const { container } = render(<RoleModule position="RB" usage={null} trend={null} />);
    expect(container.querySelectorAll('[data-role-share]')).toHaveLength(3);
    for (const row of container.querySelectorAll('[data-role-share]')) {
      expect(row.textContent).toContain("not tracked for him");
    }
  });

  it("renders the trend sentence only when the year-over-year points-per-game trend is material", () => {
    const material = render(<RoleModule position="WR" usage={USAGE} trend={MATERIAL_DECLINE} />);
    expect(material.container.textContent).toContain("18.1 a game in 2024 fell to 14.3 in 2025,");
    expect(material.container.textContent).toContain("down 3.8");
    expect(material.container.textContent).toContain("A real move, not noise.");

    const nonMaterial = render(<RoleModule position="WR" usage={USAGE} trend={NON_MATERIAL} />);
    expect(nonMaterial.container.querySelector('[data-role="trend"]')).toBeNull();

    const absent = render(<RoleModule position="WR" usage={USAGE} trend={null} />);
    expect(absent.container.querySelector('[data-role="trend"]')).toBeNull();
  });

  it("colors the trend delta in the magnitude channel, weak for a decline and good for a rise", () => {
    const decline = render(<RoleModule position="WR" usage={USAGE} trend={MATERIAL_DECLINE} />);
    const declineStat = decline.container.querySelector('[data-magnitude]');
    expect(declineStat).toHaveAttribute("data-magnitude", "weak");

    const rise = render(<RoleModule position="WR" usage={USAGE} trend={MATERIAL_RISE} />);
    const riseStat = rise.container.querySelector('[data-magnitude]');
    expect(riseStat).toHaveAttribute("data-magnitude", "good");
  });

  it("follows the copy rules — no em-dash, no semicolon", () => {
    const { container } = render(<RoleModule position="WR" usage={USAGE} trend={MATERIAL_DECLINE} />);
    expect(container.textContent).not.toMatch(/—/);
    expect(container.textContent).not.toMatch(/;/);
  });

  it("renders axe-clean in both themes", async () => {
    await renderSurface(<RoleModule position="WR" usage={USAGE} trend={MATERIAL_DECLINE} />, async ({ container }) => {
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
