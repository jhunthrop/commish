import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MATCHMAKING_CONFIG } from "@/matchmaking/config";
import { termsMoneyDisclosure } from "./disclosure";
import TermsPage from "./page";

// These pages read the session so their header can say "Your leagues" to somebody who already has
// some (founder, 2026-08-27), which makes them async server components. Signed out is the state
// these tests assert against; the header's other arm has its own test in `public-bar.test.tsx`.
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn(async () => null) }));

/**
 * Phase 4, Task 13: the money sentence on this page is derived from `moneyIsLive()` rather than
 * a fixed string — `termsMoneyDisclosure` is the one place that decision happens, testable in
 * isolation with an injected `live`, the same idiom `renderWalletContent`/`FrontDoorHero` use.
 */
describe("termsMoneyDisclosure", () => {
  it("states the free-season sentence while money is dark", async () => {
    expect(termsMoneyDisclosure(false)).toBe(MATCHMAKING_CONFIG.stakeDisclosure);
  });

  it("states the live sentence once a state is enabled, never both", async () => {
    expect(termsMoneyDisclosure(true)).toBe(MATCHMAKING_CONFIG.liveStakeDisclosure);
    expect(termsMoneyDisclosure(true)).not.toBe(MATCHMAKING_CONFIG.stakeDisclosure);
  });
});

describe("TermsPage", () => {
  it("renders the free-season disclosure today — moneyIsLive() ships false", async () => {
    render(await TermsPage());
    expect(screen.getByText(new RegExp(MATCHMAKING_CONFIG.stakeDisclosure))).toBeInTheDocument();
  });

  it("names the page", async () => {
    render(await TermsPage());
    expect(screen.getByRole("heading", { name: "Terms" })).toBeInTheDocument();
  });
});
