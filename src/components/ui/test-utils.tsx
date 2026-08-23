import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

/**
 * Renders `ui` once per theme, stamping `data-theme` exactly as the product's own theme
 * selection does, and runs `assert` against each render. Both themes are first-class (founder
 * ruling, 2026-08-23), so this is the one harness every component test renders through — the
 * theme loop lives here, not at any of its ~331 call sites, which is why `assert` takes only
 * the `RenderResult`: no call site has ever read a second argument (verified by grep), so the
 * loop can move inside the helper without touching a single caller's assertions.
 */
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
