import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { renderSurface } from "@/components/ui/test-utils";
import { AccountRoomDepsProvider } from "@/account-room/hooks/deps";
import { fixtureAccountDeps } from "@/account-room/test-fixtures";
import { NoticesProvider } from "./notices-provider";
import { AppShell, type AppShellProps } from "./app-shell";
import type { RailLeague } from "./shell-data";

// `LeagueRail` reads `usePathname()` directly (ruling 8, as amended) — same mock shape
// `league-rail.test.tsx` uses.
let pathname = "/app";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

function mockPathname(next: string): void {
  pathname = next;
}

const RAIL: readonly RailLeague[] = [
  // Already in urgency order — `shellData` sorts before the shell ever renders.
  // "needs-you" can be either "join-draft" or "fix-lineup" (Task 10 Step 1b, F1); the state
  // line carries the sentence (`railStateLine` built it from `nextAction.label`).
  { id: "lg_volt", name: "Volt Kings", state: "needs-you", needsYouKind: "join-draft", monogram: "VK", stateLine: "Join the draft" },
  { id: "lg_bandits", name: "Bay Bandits", state: "quiet", needsYouKind: null, monogram: "BB", stateLine: "3rd of 12" },
];

function baseProps(): AppShellProps {
  return {
    user: { displayName: "Ada Lovelace", avatar: null, isAdmin: false },
    rail: RAIL,
    liveState: null,
    createDefaults: { teamCount: 12, scoringPreset: "half_ppr", draftDaysFromCreation: 7 },
    children: <p>League content</p>,
  };
}

function renderShell(props: AppShellProps) {
  const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
  return render(
    <AccountRoomDepsProvider deps={fixture.deps}>
      <NoticesProvider>
        <AppShell {...props} />
      </NoticesProvider>
    </AccountRoomDepsProvider>,
  );
}

describe("AppShell", () => {
  it("renders one banner, one league rail, one footer nav and one main, so a screen reader hears a place", async () => {
    // Not "/app": that page is the rail's own full form, where the rail correctly renders null.
    mockPathname("/app/wallet");
    const fixture = fixtureAccountDeps({ ok: true, data: { notices: [], unreadCount: 0 } });
    await renderSurface(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <NoticesProvider>
          <AppShell {...baseProps()} />
        </NoticesProvider>
      </AccountRoomDepsProvider>,
      ({ getAllByRole }) => {
        expect(getAllByRole("banner")).toHaveLength(1);
        expect(getAllByRole("navigation", { name: "Your leagues" })).toHaveLength(1);
        // A3: the shell's own footer, always present outside the admin console.
        expect(getAllByRole("navigation", { name: "Support and legal" })).toHaveLength(1);
        expect(getAllByRole("main")).toHaveLength(1);
      },
    );
  });

  // A3, N2: Support/Terms/Privacy/How it works were unreachable from all 17 signed-in routes —
  // PublicFooter was their only door and AppShell never rendered it. Every AppShell render now
  // carries a quiet equivalent, regardless of which page is inside <main>.
  it("carries Support, How it works, Terms and Privacy on every render, beneath the content", () => {
    mockPathname("/app");
    const { getByRole } = renderShell(baseProps());
    expect(getByRole("link", { name: "Support" })).toHaveAttribute("href", "/support");
    expect(getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/league-rules");
    expect(getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/legal/terms");
    expect(getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/legal/privacy");
  });

  // A4, N3: five of six operator surfaces had no inbound link anywhere in the product.
  describe("the admin console nav (A4)", () => {
    it("lists all six operator surfaces for an admin standing on /app/admin/*", () => {
      mockPathname("/app/admin/queue");
      const props: AppShellProps = { ...baseProps(), user: { displayName: "Ada Lovelace", avatar: null, isAdmin: true } };
      const { getByRole } = renderShell(props);
      expect(getByRole("link", { name: "Dispute queue" })).toHaveAttribute("href", "/app/admin/queue");
      expect(getByRole("link", { name: "Held payouts" })).toHaveAttribute("href", "/app/admin/holds");
      expect(getByRole("link", { name: "Self exclusion" })).toHaveAttribute("href", "/app/admin/exclusions");
      expect(getByRole("link", { name: "Settle league" })).toHaveAttribute("href", "/app/admin/leagues/settle");
      expect(getByRole("link", { name: "Dissolve league" })).toHaveAttribute("href", "/app/admin/leagues/dissolve");
      expect(getByRole("link", { name: "Money reconciliation" })).toHaveAttribute("href", "/app/admin/money/reconcile");
    });

    it("never renders for an ordinary member, even standing on an admin URL", () => {
      mockPathname("/app/admin/queue");
      const { queryByRole } = renderShell(baseProps());
      expect(queryByRole("link", { name: "Dispute queue" })).not.toBeInTheDocument();
    });

    it("stays silent for an admin anywhere outside /app/admin/*", () => {
      mockPathname("/app");
      const props: AppShellProps = { ...baseProps(), user: { displayName: "Ada Lovelace", avatar: null, isAdmin: true } };
      const { queryByRole } = renderShell(props);
      expect(queryByRole("navigation", { name: "Admin console" })).not.toBeInTheDocument();
    });
  });

  it("marks the league the current URL belongs to, by aria-current and not by color", () => {
    // The rail reads the path it is standing on rather than being told: `usePathname()` is the
    // fact, and it is why the shell can live in a layout at all (ruling 8, as amended).
    mockPathname("/app/leagues/lg_bandits/matchups/3");
    const { getByRole } = renderShell(baseProps());
    expect(getByRole("link", { name: /Bay Bandits/ })).toHaveAttribute("aria-current", "page");
  });

  it("gives every crest an accessible name that is the league's real name, never its initials", () => {
    // The rail is 40px tiles reading two-letter initials. Initials are a VISUAL compression and
    // are meaningless read aloud; the accessible name is the league, and the state dot is
    // words. The action half of the name is the one string COPY owns in `next-action.ts` (C2).
    mockPathname("/app/wallet");
    const { getByRole } = renderShell(baseProps());
    expect(getByRole("link", { name: "Volt Kings. Join the draft." })).toBeInTheDocument();
  });

  // Fix round 1, H1: the missing combination that let a hardcoded "needs-you" -> "join-draft"
  // map ship — a manager whose LINEUP is unset must never hear "Join the draft."
  it("says 'Fix your lineup', not 'Join the draft', for a needs-you league whose kind is fix-lineup", () => {
    mockPathname("/app/wallet");
    const props: AppShellProps = {
      ...baseProps(),
      rail: [{ id: "lg_volt", name: "Volt Kings", state: "needs-you", needsYouKind: "fix-lineup", monogram: "VK", stateLine: "Fix your lineup" }],
    };
    const { getByRole, queryByRole } = renderShell(props);
    expect(getByRole("link", { name: "Volt Kings. Fix your lineup." })).toBeInTheDocument();
    expect(queryByRole("link", { name: /Join the draft/ })).not.toBeInTheDocument();
  });

  it("keeps the rail reachable at 360px by becoming a horizontal strip, not by disappearing", () => {
    mockPathname("/app/wallet");
    const { getByTestId } = renderShell(baseProps());
    // The strip's scroll lives on the row container inside the nav now (the flyout rebuild).
    expect(getByTestId("league-rail").querySelector(".overflow-x-auto")).not.toBeNull();
    expect(getByTestId("league-rail").className).not.toMatch(/hidden/);
  });

  it("renders no league rail at all on /app — the page is the rail's own full form (law 3)", () => {
    mockPathname("/app");
    const { queryByRole } = renderShell(baseProps());
    expect(queryByRole("navigation", { name: "Your leagues" })).not.toBeInTheDocument();
  });

  it("renders no max-w-* on <main> — full-bleed frames, measured paragraphs (Step 2)", () => {
    mockPathname("/app");
    const { container } = renderShell(baseProps());
    const main = container.querySelector("main")!;
    expect(main.className).not.toMatch(/max-w-/);
  });

  it("renders the caller's children inside the one <main>", () => {
    mockPathname("/app");
    const { getByText } = renderShell(baseProps());
    expect(getByText("League content")).toBeInTheDocument();
  });
});
