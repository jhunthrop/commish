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
});
