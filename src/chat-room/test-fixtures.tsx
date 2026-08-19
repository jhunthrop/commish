import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import type { ChatMessageView, ChatPageBody } from "@/chat/contract";
import { ChatRoomDepsProvider, type ChatRoomDeps } from "./hooks/deps";

export function chatMessage(id: string, overrides: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    id,
    authorUserId: "u2",
    authorName: "Jordan Lee",
    authorAvatarUrl: null,
    body: `message ${id}`,
    createdAt: "2026-08-18T12:00:00.000Z",
    reactions: [],
    ...overrides,
  };
}

export const CHAT_PAGE: ChatPageBody = {
  leagueId: "l1",
  meUserId: "u1",
  messages: [chatMessage("1", { body: "wheels up" }), chatMessage("2", { authorUserId: "u1", authorName: "Alex Rivera", body: "let's go" })],
  hasMore: false,
};

interface FixtureChatDeps {
  deps: ChatRoomDeps;
  readonly calls: string[];
  /** Mutable: the envelope the next request answers with. Defaults to the page above. */
  response: unknown;
  /** Push a frame down the fake stream, exactly as the SSE route would. */
  emit: (type: string, payload: unknown) => void;
  /** Fire the stream's own lifecycle events. */
  fire: (type: "open" | "error") => void;
  /** How many requests are still unresolved. Always 0 unless `deferred` was set. */
  pending: () => number;
  /**
   * Resolve the Nth still-unresolved request (0-based, in call order) with a specific envelope.
   * Only meaningful in deferred mode, which is what lets a test choose the ORDER two concurrent
   * refreshes resolve in — the whole point of the race this hook has to survive.
   */
  settle: (index: number, response: unknown) => Promise<void>;
}

/** One injected fetch + one fake EventSource. No module mocks, no real network. */
export function fixtureChatDeps(page: ChatPageBody = CHAT_PAGE, options: { readonly deferred?: boolean } = {}): FixtureChatDeps {
  const listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  const waiting: ((response: unknown) => void)[] = [];
  const fixture: FixtureChatDeps = {
    calls: [],
    response: { ok: true, data: page },
    emit: (type, payload) => {
      for (const listener of listeners.get(type) ?? []) {
        listener({ data: JSON.stringify({ type, leagueId: "l1", payload }) } as MessageEvent);
      }
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
      // Let the hook's own `await response.json()` continuation run before the test asserts.
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

export function renderInChat(ui: ReactElement, deps: ChatRoomDeps): RenderResult {
  return render(<ChatRoomDepsProvider deps={deps}>{ui}</ChatRoomDepsProvider>);
}
