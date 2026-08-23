import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";

describe("Badge", () => {
  it("renders text with a tone class", () => {
    render(<Badge tone="positive">Won</Badge>);
    expect(screen.getByText("Won").className).toMatch(/positive/);
  });
  it("defaults to neutral", () => {
    render(<Badge>Bench</Badge>);
    expect(screen.getByText("Bench").className).toMatch(/border/);
  });

  it("adds a tinted ring only when glow is set", () => {
    render(<Badge tone="accent">Live</Badge>);
    expect(screen.getByText("Live").className).not.toMatch(/ring-accent-glow/);
    render(
      <Badge tone="accent" glow>
        Live
      </Badge>,
    );
    expect(screen.getAllByText("Live")[1]!.className).toMatch(/ring-accent-glow/);
  });

  it("ignores glow on a tone with no glow token", () => {
    render(
      <Badge tone="neutral" glow>
        Bench
      </Badge>,
    );
    expect(screen.getByText("Bench").className).not.toMatch(/ring-/);
  });
});
