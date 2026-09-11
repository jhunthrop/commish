import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { ThemeProvider } from "@/design/theme-provider";
import { ThemeSwitcher } from "./theme-switcher";

type Listener = (event: { matches: boolean }) => void;

/** Mirrors `use-reduced-motion.test.tsx`'s own `stubMatchMedia` — the same "stub, capture the
 *  change listener, let a test fire it" shape, scoped to `(prefers-color-scheme: dark)`. */
function stubMatchMedia(matches: boolean) {
  const listeners: Listener[] = [];
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-color-scheme: dark)" ? matches : false,
    media: query,
    addEventListener: (_type: string, listener: Listener) => listeners.push(listener),
    removeEventListener: (_type: string, listener: Listener) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
  }));
  return { emit: (next: boolean) => listeners.forEach((l) => l({ matches: next })) };
}

function renderSwitcher() {
  return render(
    <ThemeProvider>
      <ThemeSwitcher />
    </ThemeProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("ThemeSwitcher", () => {
  it("defaults to system and states the device's own resolution in words, dark", () => {
    stubMatchMedia(true);
    renderSwitcher();
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("System · dark right now")).toBeInTheDocument();
  });

  it("states the device's own resolution in words, light", () => {
    stubMatchMedia(false);
    renderSwitcher();
    expect(screen.getByText("System · light right now")).toBeInTheDocument();
  });

  it("switches to an explicit choice, persists it, and states it as unconditional", () => {
    stubMatchMedia(true);
    renderSwitcher();

    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Always light")).toBeInTheDocument();
    // The same seam `ThemeProvider`'s own test drives directly through `useTheme` — this control
    // adds no persistence of its own.
    expect(window.localStorage.getItem("commish.theme")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(screen.getByText("Always dark")).toBeInTheDocument();
    expect(window.localStorage.getItem("commish.theme")).toBe("dark");
  });

  it("returns to system on request and drops the stamp", () => {
    stubMatchMedia(true);
    renderSwitcher();
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    fireEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    expect(window.localStorage.getItem("commish.theme")).toBeNull();
  });

  // Fix round 1, F1: `AvatarPicker`'s exact roving-tabindex shape (`avatar-picker.test.tsx`) —
  // "only the checked tile is tabbable" is a claim about EVERY option, so this checks all three
  // rather than the one that happens to be selected.
  it("leaves exactly one option tabbable — the one matching the current theme", () => {
    stubMatchMedia(true);
    renderSwitcher();
    const options = screen.getAllByRole("radio");
    expect(options.map((option) => option.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(screen.getAllByRole("radio").map((option) => option.getAttribute("tabindex"))).toEqual(["-1", "-1", "0"]);
  });

  it("ArrowRight moves focus and selection to the next option, wrapping past the last", () => {
    stubMatchMedia(true);
    renderSwitcher();
    screen.getByRole("radio", { name: "System" }).focus();

    fireEvent.keyDown(screen.getByRole("radio", { name: "System" }), { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Light" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("radio", { name: "Light" }), { key: "ArrowDown" });
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveFocus();

    // Wraps past the last option back to the first.
    fireEvent.keyDown(screen.getByRole("radio", { name: "Dark" }), { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "System" })).toHaveFocus();
  });

  it("ArrowLeft moves focus and selection to the previous option, wrapping before the first", () => {
    stubMatchMedia(true);
    renderSwitcher();
    screen.getByRole("radio", { name: "System" }).focus();

    // Wraps before the first option to the last.
    fireEvent.keyDown(screen.getByRole("radio", { name: "System" }), { key: "ArrowLeft" });
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("radio", { name: "Dark" }), { key: "ArrowUp" });
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Light" })).toHaveFocus();
  });

  it("Home and End jump to the first and last option", () => {
    stubMatchMedia(true);
    renderSwitcher();
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));

    fireEvent.keyDown(screen.getByRole("radio", { name: "Light" }), { key: "End" });
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("radio", { name: "Dark" }), { key: "Home" });
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "System" })).toHaveFocus();
  });

  /**
   * NOT `renderSurface` (`@/components/ui/test-utils`): that harness forces `data-theme`
   * externally, which is exactly what every OTHER component test wants (a passive reader of the
   * CSS custom properties) and exactly what this one component does not — `ThemeSwitcher` sits
   * inside `ThemeProvider`, which owns `data-theme` itself and would overwrite whatever
   * `renderSurface` just set the moment it mounts. So this drives the real mechanism instead:
   * `ThemeProvider` reading a stored preference from `localStorage` is how this app actually
   * reaches each theme, and asserting the attribute landed before calling `axe` is what proves
   * the loop below tests two different themes rather than the same one twice.
   */
  it("is axe-clean in both themes", async () => {
    stubMatchMedia(true);
    for (const stored of ["light", "dark"] as const) {
      window.localStorage.setItem("commish.theme", stored);
      const { container, unmount } = renderSwitcher();
      await waitFor(() => expect(document.documentElement.getAttribute("data-theme")).toBe(stored));
      expect(await axe(container)).toHaveNoViolations();
      unmount();
      window.localStorage.clear();
      document.documentElement.removeAttribute("data-theme");
    }
  });
});
