import { render, type RenderResult } from "@testing-library/react";
import { act, type ReactElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { vi } from "vitest";

/**
 * Renders `ui` once per theme, stamping `data-theme` exactly as the product's own theme
 * selection does, and runs `assert` against each render. Both themes are first-class (founder
 * ruling, 2026-08-23), so this is the one harness every component test renders through — the
 * theme loop lives here, not at any of its ~331 call sites, which is why `assert` takes only
 * the `RenderResult`: no call site has ever read a second argument (verified by grep), so the
 * loop can move inside the helper without touching a single caller's assertions.
 */
export interface HydrateSurfaceResult {
  /** The container the server HTML was written into and React hydrated onto. */
  readonly container: HTMLElement;
  /** The exact HTML `renderToString` produced — what the server would have sent. */
  readonly serverHtml: string;
  /** Everything React routed through `onRecoverableError` while hydrating — a hydration
   *  mismatch lands HERE in React 19, not as a thrown error. */
  readonly recoverableErrors: readonly unknown[];
  /** Every `console.error` call made while hydrating — the channel React prints the
   *  "server rendered HTML didn't match the client" diff on. */
  readonly consoleErrors: ReadonlyArray<readonly unknown[]>;
}

/**
 * THE repo's SSR-hydration harness (first added for the `useNow` hydration-mismatch fix,
 * founder-reported 2026-08-24): renders `makeUi()` to a string the way the server does
 * (`renderToString`), writes that HTML into a detached-then-attached container, then hydrates a
 * SECOND `makeUi()` render onto it with `hydrateRoot` — exactly the sequence a Next.js page runs
 * — capturing every recoverable error and `console.error` the hydration pass emits. A test
 * asserts both arrays are EMPTY to prove the server HTML and the client's first render agree
 * byte-for-byte; `options.beforeHydrate` exists to simulate the real-world skew that makes time
 * bugs bite (advance the fake clock between "server" and "client" renders — the bug class this
 * harness was built to catch renders wall-clock time during SSR and recomputes it milliseconds
 * later while hydrating).
 *
 * `assert` runs while the hydrated tree is still mounted (post-hydration effects flushed), so it
 * can also drive timers forward inside `act` and assert the live behavior that begins only after
 * hydration. Cleanup is the harness's job, mirroring `renderSurface` above.
 */
export async function hydrateSurface(
  makeUi: () => ReactElement,
  assert: (r: HydrateSurfaceResult) => void | Promise<void>,
  options: { readonly beforeHydrate?: () => void } = {},
): Promise<void> {
  // Manual `hydrateRoot` + `act` (RTL has no hydration entry point that surfaces the error
  // channels); React requires this flag for `act` outside RTL's own render.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const serverHtml = renderToString(makeUi());
  const container = document.createElement("div");
  container.innerHTML = serverHtml;
  document.body.appendChild(container);

  const recoverableErrors: unknown[] = [];
  const consoleErrors: Array<readonly unknown[]> = [];
  options.beforeHydrate?.();
  const spy = vi.spyOn(console, "error").mockImplementation((...args: readonly unknown[]) => {
    consoleErrors.push(args);
  });
  let root: ReturnType<typeof hydrateRoot> | null = null;
  try {
    await act(async () => {
      root = hydrateRoot(container, makeUi(), {
        onRecoverableError: (error) => {
          recoverableErrors.push(error);
        },
      });
    });
    spy.mockRestore();
    await assert({ container, serverHtml, recoverableErrors, consoleErrors });
  } finally {
    spy.mockRestore();
    if (root !== null) {
      const mounted: ReturnType<typeof hydrateRoot> = root;
      await act(async () => {
        mounted.unmount();
      });
    }
    container.remove();
  }
}

export function renderSurface(ui: ReactElement, assert: (r: RenderResult) => void | Promise<void>) {
  return (async () => {
    try {
      for (const theme of ["light", "dark"] as const) {
        document.documentElement.setAttribute("data-theme", theme);
        const r = render(ui);
        try {
          await assert(r);
        } finally {
          r.unmount();
        }
      }
    } finally {
      document.documentElement.removeAttribute("data-theme");
    }
  })();
}
