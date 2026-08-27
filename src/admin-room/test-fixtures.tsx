import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { AdminRoomDepsProvider, type AdminRoomDeps } from "./hooks/deps";

/** Either a single envelope every call answers with (the original shape), or a function that
 *  picks the envelope from the request itself — the read-then-confirm flows (Task 5's operator
 *  review fix) issue a `GET` preview and then a `POST`/`DELETE` mutation from the SAME test, and
 *  the two need different bodies. */
export type FixtureResponder = unknown | ((url: string, init: RequestInit | undefined) => unknown);

interface FixtureAdminDeps {
  readonly deps: AdminRoomDeps;
  readonly calls: string[];
  /** Mutable: set the envelope (or responder function) the next request should answer with. */
  response: FixtureResponder;
}

/** One injected `fetchJson` per admin-room component — no module mocks, no real network,
 *  mirrors `fixtureAccountDeps` (`@/account-room/test-fixtures`) minus the realtime half this
 *  surface has no use for. */
export function fixtureAdminDeps(response: FixtureResponder = { ok: true, data: { flagId: "flag_1", decision: "no_action" } }): FixtureAdminDeps {
  const fixture: FixtureAdminDeps = {
    calls: [],
    response,
    deps: {
      fetchJson: async (url, init) => {
        fixture.calls.push(`${init?.method ?? "GET"} ${url}`);
        const body = typeof fixture.response === "function" ? (fixture.response as (url: string, init: RequestInit | undefined) => unknown)(url, init) : fixture.response;
        return { json: async () => body } as unknown as Response;
      },
    },
  };
  return fixture;
}

export function renderInAdmin(ui: ReactElement, deps: AdminRoomDeps): RenderResult {
  return render(<AdminRoomDepsProvider deps={deps}>{ui}</AdminRoomDepsProvider>);
}
