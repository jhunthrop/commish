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
  /** Push a frame down the fake stream, exactly as `/api/notices/stream` would. */
  emit: (type: string, payload: unknown) => void;
  /** Fire the stream's own lifecycle events. */
  fire: (type: "open" | "error") => void;
}

/** One injected `fetchJson` + one fake `EventSource` for every account-room component. No
 *  module mocks, no real network — mirrors `fixtureLeagueDeps` (`@/league-room/test-fixtures`).
 *  The stream half exists for `NoticeInbox`/`useNotices` (Task 10): everything else under
 *  `src/account-room/**` never calls `openEventSource` at all, so it is unused dead weight in
 *  their tests and a real fake everywhere the inbox is rendered. */
export function fixtureAccountDeps(response: unknown = { ok: true, data: PROFILE }): FixtureAccountDeps {
  const listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  const fixture: FixtureAccountDeps = {
    calls: [],
    response,
    emit: (type, payload) => {
      for (const listener of listeners.get(type) ?? []) listener({ data: JSON.stringify({ type, payload }) } as MessageEvent);
    },
    fire: (type) => {
      for (const listener of listeners.get(type) ?? []) listener({ data: "" } as MessageEvent);
    },
    deps: {
      fetchJson: async (url, init) => {
        fixture.calls.push(`${init?.method ?? "GET"} ${url}`);
        return { json: async () => fixture.response } as unknown as Response;
      },
      openEventSource: () => ({
        addEventListener: (type, listener) => {
          listeners.set(type, [...(listeners.get(type) ?? []), listener]);
        },
        close: () => listeners.clear(),
      }),
    },
  };
  return fixture;
}

export function renderInAccount(ui: ReactElement, deps: AccountRoomDeps): RenderResult {
  return render(<AccountRoomDepsProvider deps={deps}>{ui}</AccountRoomDepsProvider>);
}
