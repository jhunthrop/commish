import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import type { ProfileBody } from "./contract";
import { AccountRoomDepsProvider, type AccountRoomDeps } from "./hooks/deps";

export const PROFILE: ProfileBody = {
  displayName: "Ada Lovelace",
  experienceTier: "beginner",
  avatarPreset: null,
  avatar: null,
};

interface FixtureAccountDeps {
  deps: AccountRoomDeps;
  readonly calls: string[];
  /** Mutable: set the envelope the next request should answer with. */
  response: unknown;
}

/** One injected `fetchJson` for every account-room component. No module mocks, no real
 *  network — mirrors `fixtureLeagueDeps` (`@/league-room/test-fixtures`). */
export function fixtureAccountDeps(response: unknown = { ok: true, data: PROFILE }): FixtureAccountDeps {
  const fixture: FixtureAccountDeps = {
    calls: [],
    response,
    deps: {
      fetchJson: async (url, init) => {
        fixture.calls.push(`${init?.method ?? "GET"} ${url}`);
        return { json: async () => fixture.response } as unknown as Response;
      },
    },
  };
  return fixture;
}

export function renderInAccount(ui: ReactElement, deps: AccountRoomDeps): RenderResult {
  return render(<AccountRoomDepsProvider deps={deps}>{ui}</AccountRoomDepsProvider>);
}
