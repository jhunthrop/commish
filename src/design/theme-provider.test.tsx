import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./theme-provider";

function Probe() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={() => setTheme("dark")}>dark</button>
      <button onClick={() => setTheme("light")}>light</button>
      <button onClick={() => setTheme("system")}>system</button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("ThemeProvider", () => {
  it("defaults to system and stamps nothing on <html>", () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId("theme").textContent).toBe("system");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("setTheme('dark') stamps data-theme and persists", () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    act(() => screen.getByText("dark").click());
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(window.localStorage.getItem("commish.theme")).toBe("dark");
  });

  it("restores a persisted choice on mount", () => {
    window.localStorage.setItem("commish.theme", "light");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId("theme").textContent).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("setTheme('system') removes the stamp", () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    act(() => screen.getByText("dark").click());
    act(() => screen.getByText("system").click());
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });
});
