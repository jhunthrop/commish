import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Law } from "@/projections/laws/types";
import PlayerLawsPage from "./page";

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn(async () => null) }));

const registryMock = vi.hoisted(() => vi.fn<() => readonly Law[]>());
vi.mock("@/projections/laws/registry", () => ({ registry: registryMock }));

/**
 * `boardConsequenceSentence` (fix round, I7): the page's own "where these show up" sentence used to
 * be a static claim — "every confirmed law feeds the board's own rankings" — which stopped being
 * true the moment a law could be confirmed with no `modelPath` wired to it yet. These render the
 * whole page with a controlled `registry()` fixture and read the sentence back off the DOM, so a
 * regression to a hardcoded claim would fail here rather than only being caught by inspection.
 */
function lawFixture(over: Partial<Law> = {}): Law {
  return {
    id: "fake_law",
    position: "RB",
    claim: "Fake law: a claim for fixtures only.",
    measured: { effect: -1, ci: [-2, -0.5], sample: 100, seasons: "2013-2023" },
    verdict: "confirmed",
    modelPath: null,
    ...over,
  };
}

describe("PlayerLawsPage — boardConsequenceSentence", () => {
  it("says every confirmed law feeds the rankings when every confirmed law is wired", async () => {
    registryMock.mockReturnValue([lawFixture({ id: "a", modelPath: "src/x.ts#y" }), lawFixture({ id: "b", modelPath: "src/x.ts#z" })]);
    render(await PlayerLawsPage());
    expect(screen.getByText(/Every confirmed law here feeds the board's own rankings/)).toBeInTheDocument();
  });

  it("says none are wired yet when every confirmed law lacks a modelPath", async () => {
    registryMock.mockReturnValue([lawFixture({ id: "a", modelPath: null }), lawFixture({ id: "b", modelPath: null })]);
    render(await PlayerLawsPage());
    expect(screen.getByText(/None of the confirmed laws here are wired into the board's rankings yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Every confirmed law here feeds/)).not.toBeInTheDocument();
  });

  it("counts a partial wiring rather than defaulting to the all-or-nothing sentence", async () => {
    registryMock.mockReturnValue([
      lawFixture({ id: "a", modelPath: "src/x.ts#y" }),
      lawFixture({ id: "b", modelPath: null }),
      lawFixture({ id: "c", modelPath: null }),
    ]);
    render(await PlayerLawsPage());
    expect(screen.getByText(/1 of 3 confirmed laws here feed the board's own rankings/)).toBeInTheDocument();
  });

  it("falls back to the chip-only sentence when nothing is confirmed", async () => {
    registryMock.mockReturnValue([lawFixture({ id: "a", verdict: "weak" }), lawFixture({ id: "b", verdict: "debunked" })]);
    render(await PlayerLawsPage());
    expect(screen.getByText(/^A reason chip beside a player's name states a confirmed law's measured effect/)).toBeInTheDocument();
  });

  it("always states the chip consequence, regardless of wiring", async () => {
    registryMock.mockReturnValue([lawFixture({ id: "a", modelPath: "src/x.ts#y" })]);
    render(await PlayerLawsPage());
    expect(screen.getByText(/a reason chip beside a player's name states/)).toBeInTheDocument();
  });
});
