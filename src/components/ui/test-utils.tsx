import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

/** Renders in light, then dark, running the assertion in each. */
export function inBothThemes(
  ui: ReactElement,
  assert: (r: RenderResult, theme: "light" | "dark") => void | Promise<void>,
) {
  return (async () => {
    for (const theme of ["light", "dark"] as const) {
      document.documentElement.setAttribute("data-theme", theme);
      const r = render(ui);
      await assert(r, theme);
      r.unmount();
    }
    document.documentElement.removeAttribute("data-theme");
  })();
}
