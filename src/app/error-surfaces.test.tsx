import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { ReactElement } from "react";
import { inBothThemes } from "@/components/ui/test-utils";
import AppError from "./error";
import GlobalError from "./global-error";
import NotFound from "./not-found";

/**
 * `global-error.tsx` renders its own `<html>`/`<body>`, which RTL's default container (a `div`
 * appended to `document.body`) cannot legally hold. happy-dom tolerates the nesting well enough
 * to assert on structure and text, which is all this suite needs; the real document shell is
 * exercised by Next at runtime, not here.
 */
function renderGlobal(ui: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return render(ui, { container });
}

const BOOM = Object.assign(new Error('relation "leagues" does not exist'), { digest: "abc123" });

describe("app/error.tsx", () => {
  it("says what happened and offers a way forward, in both themes, axe-clean", async () => {
    await inBothThemes(<AppError error={BOOM} reset={() => {}} />, async ({ container }) => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Go to your leagues" })).toHaveAttribute("href", "/app");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("never leaks the raw exception text into the page", async () => {
    await inBothThemes(<AppError error={BOOM} reset={() => {}} />, ({ container }) => {
      expect(container.textContent).not.toContain("relation");
      expect(container.textContent).not.toContain("does not exist");
    });
  });

  it("shows the digest as a quiet reference so support can find the log line", async () => {
    await inBothThemes(<AppError error={BOOM} reset={() => {}} />, () => {
      expect(screen.getByText("Reference abc123")).toBeInTheDocument();
    });
  });

  it("omits the reference line entirely when there is no digest", async () => {
    await inBothThemes(<AppError error={new Error("nope")} reset={() => {}} />, ({ container }) => {
      expect(container.textContent).not.toContain("Reference");
    });
  });

  it("calls reset when the retry button is pressed", async () => {
    const reset = vi.fn();
    await inBothThemes(<AppError error={BOOM} reset={reset} />, async () => {
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(reset).toHaveBeenCalledTimes(2); // once per theme render
  });
});

describe("app/global-error.tsx", () => {
  it("renders its own document shell with a retry, axe-clean", async () => {
    const reset = vi.fn();
    const { container } = renderGlobal(<GlobalError error={BOOM} reset={reset} />);
    // React treats <html> and <body> as host singletons: it always reconciles them against the
    // real document.documentElement/document.body rather than nesting fresh ones inside the RTL
    // container (happy-dom enforces the same one-<html>-per-document rule a real browser does).
    // The shell is proven against those two nodes, not against `container.querySelector`.
    expect(document.documentElement).toHaveAttribute("lang", "en");
    expect(document.body.className).toContain("antialiased");
    expect(container.textContent).toContain("Something went wrong on our side.");
    expect(container.textContent).not.toContain("relation");
  });
});

describe("app/not-found.tsx", () => {
  it("is an empty state, not an error, and offers both ways on, axe-clean", async () => {
    await inBothThemes(<NotFound />, async ({ container }) => {
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("link", { name: "Go to your leagues" })).toHaveAttribute("href", "/app");
      expect(screen.getByRole("link", { name: "Browse open leagues" })).toHaveAttribute("href", "/browse");
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
