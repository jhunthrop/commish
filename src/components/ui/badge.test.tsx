import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "./test-utils";
import { Badge } from "./badge";
import { LiveChip } from "./live-chip";

describe("Badge", () => {
  it("is a pill of small semibold text on the tone's own wash, in both themes, axe-clean", async () => {
    await renderSurface(<Badge tone="positive">Won</Badge>, async ({ container }) => {
      const chip = screen.getByText("Won");
      expect(chip.className).toContain("rounded-pill");
      expect(chip.className).toContain("text-xs");
      expect(chip.className).toContain("font-semibold");
      expect(chip.className).toContain("bg-positive/10");
      expect(chip.className).toContain("text-positive");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("defaults to the chalk chip with muted ink", () => {
    render(<Badge>Bench</Badge>);
    expect(screen.getByText("Bench").className).toContain("bg-surface");
    expect(screen.getByText("Bench").className).toContain("text-text-muted");
    expect(screen.getByText("Bench").className).not.toContain("border");
  });

  it("spends the six pigments and no more: warning is the rose, self is the amber, live is the green", () => {
    render(
      <>
        <Badge tone="warning">Clock</Badge>
        <Badge tone="negative">Rival</Badge>
        <Badge tone="self">Yours</Badge>
        <Badge tone="live">Live</Badge>
        <Badge tone="accent">Link</Badge>
      </>,
    );
    expect(screen.getByText("Clock").className).toContain("text-negative");
    expect(screen.getByText("Rival").className).toContain("text-negative");
    expect(screen.getByText("Yours").className).toContain("text-self-ink");
    expect(screen.getByText("Yours").className).toContain("bg-self-glow");
    expect(screen.getByText("Live").className).toContain("text-live");
    expect(screen.getByText("Live").className).toContain("bg-live/10");
    // Court blue ink never rides its own wash (4.44:1): a link chip is blue on chalk.
    expect(screen.getByText("Link").className).toContain("text-accent");
    expect(screen.getByText("Link").className).not.toContain("bg-accent");
  });

  it("adds a tinted ring only when glow is set, and only on a tone that has one", () => {
    render(<Badge tone="accent">Quiet</Badge>);
    expect(screen.getByText("Quiet").className).not.toMatch(/ring-/);
    render(
      <Badge tone="self" glow>
        Needs you
      </Badge>,
    );
    expect(screen.getByText("Needs you").className).toMatch(/ring-self-glow/);
    render(
      <Badge tone="neutral" glow>
        Bench
      </Badge>,
    );
    expect(screen.getByText("Bench").className).not.toMatch(/ring-/);
  });

  it("puts the breathing dot inside a glowing live chip instead of a ring", () => {
    render(
      <Badge tone="live" glow>
        Live
      </Badge>,
    );
    const chip = screen.getByText("Live");
    expect(chip.querySelector("[data-testid='presence-dot']")).not.toBeNull();
    expect(chip.className).not.toMatch(/ring-/);
  });

  it("LiveChip is that chip by name, axe-clean in both themes", async () => {
    await renderSurface(<LiveChip>3 games on</LiveChip>, async ({ container }) => {
      const chip = screen.getByText("3 games on");
      expect(chip.className).toContain("text-live");
      expect(chip.querySelector("[data-testid='presence-dot']")).not.toBeNull();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("accepts the retired soft flag without changing anything, so older call sites compile", () => {
    render(
      <Badge tone="positive" soft>
        Safe
      </Badge>,
    );
    expect(screen.getByText("Safe").className).toContain("bg-positive/10");
    expect(screen.getByText("Safe")).not.toHaveAttribute("soft");
  });
});
