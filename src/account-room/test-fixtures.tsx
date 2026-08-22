import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { NoticesProvider } from "@/components/app-shell/notices-provider";
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
  /** How many `fetchJson` calls are still unresolved. Always 0 unless `deferred` was set. */
  pending: () => number;
  /** Resolve the Nth still-unresolved request (0-based, in call order) with a specific envelope
   *  — only meaningful in deferred mode, which is what lets a test choose the ORDER two
   *  concurrent requests (or a request racing a local write) resolve in. Mirrors
   *  `fixtureLeagueDeps`'s own `settle`. */
  settle: (index: number, response: unknown) => Promise<void>;
}

/** One injected `fetchJson` + one fake `EventSource` for every account-room component. No
 *  module mocks, no real network — mirrors `fixtureLeagueDeps` (`@/league-room/test-fixtures`).
 *  The stream half exists for `NoticeInbox`/`useNotices` (Task 10): everything else under
 *  `src/account-room/**` never calls `openEventSource` at all, so it is unused dead weight in
 *  their tests and a real fake everywhere the inbox is rendered.
 *
 * `options.deferred` (also mirroring `fixtureLeagueDeps`) holds every `fetchJson` call open
 * until the test explicitly `settle`s it — the seam `useNotices`' own refetch-vs-markRead race
 * test needs: a slow early fetch has to still be IN FLIGHT when a later `markRead` resolves, so
 * the test can prove the slow response is refused rather than clobbering the optimistic read. */
export function fixtureAccountDeps(
  response: unknown = { ok: true, data: PROFILE },
  options: { readonly deferred?: boolean } = {},
): FixtureAccountDeps {
  const listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  const waiting: ((response: unknown) => void)[] = [];
  const fixture: FixtureAccountDeps = {
    calls: [],
    response,
    emit: (type, payload) => {
      for (const listener of listeners.get(type) ?? []) listener({ data: JSON.stringify({ type, payload }) } as MessageEvent);
    },
    fire: (type) => {
      for (const listener of listeners.get(type) ?? []) listener({ data: "" } as MessageEvent);
    },
    pending: () => waiting.filter((entry) => entry !== undefined).length,
    settle: async (index, response) => {
      const resolve = waiting[index];
      if (resolve === undefined) throw new Error(`no pending request at index ${index}`);
      delete waiting[index];
      resolve(response);
      // Let the caller's own `await response.json()` continuation run before the test asserts.
      await Promise.resolve();
      await Promise.resolve();
    },
    deps: {
      fetchJson: async (url, init) => {
        fixture.calls.push(`${init?.method ?? "GET"} ${url}`);
        if (options.deferred !== true) {
          return { json: async () => fixture.response } as unknown as Response;
        }
        const index = waiting.length;
        const body = await new Promise<unknown>((resolve) => {
          waiting[index] = resolve;
        });
        return { json: async () => body } as unknown as Response;
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

/** `NoticesProvider` (Plan D Task 9, fix round 1) wraps every case here, not only the notice
 *  ones: `useNotices()` now throws without a provider ancestor, and `NoticeInbox` — reached
 *  through `AppHeader` on several of this file's own callers' pages, and directly by
 *  `notice-inbox.test.tsx` — is the one component under `src/account-room/**` that calls it. A
 *  component that never calls `useNotices()` renders identically with or without this wrapper. */
export function renderInAccount(ui: ReactElement, deps: AccountRoomDeps): RenderResult {
  return render(
    <AccountRoomDepsProvider deps={deps}>
      <NoticesProvider>{ui}</NoticesProvider>
    </AccountRoomDepsProvider>,
  );
}
