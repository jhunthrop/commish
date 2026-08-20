import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { AdminRoomDepsProvider, type AdminRoomDeps } from "./hooks/deps";

interface FixtureAdminDeps {
  readonly deps: AdminRoomDeps;
  readonly calls: string[];
  /** Mutable: set the envelope the next request should answer with. */
  response: unknown;
}

/** One injected `fetchJson` per admin-room component — no module mocks, no real network,
 *  mirrors `fixtureAccountDeps` (`@/account-room/test-fixtures`) minus the realtime half this
 *  surface has no use for. */
export function fixtureAdminDeps(response: unknown = { ok: true, data: { flagId: "flag_1", decision: "no_action" } }): FixtureAdminDeps {
  const fixture: FixtureAdminDeps = {
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

export function renderInAdmin(ui: ReactElement, deps: AdminRoomDeps): RenderResult {
  return render(<AdminRoomDepsProvider deps={deps}>{ui}</AdminRoomDepsProvider>);
}
