import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import type { ReactElement } from "react";
import { renderSurface } from "@/components/ui/test-utils";
import AppError from "./error";
import GlobalError, { GlobalErrorContent } from "./global-error";
import NotFound from "./not-found";

// `not-found.tsx` reads the session now, so its header can say "Your leagues" to somebody who
// already has some (founder, 2026-08-27) — which makes it an async server component. Signed out is
// the state these tests assert; the header's other arm is covered in `public-bar.test.tsx`.
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn(async () => null) }));

/**
 * `global-error.tsx` renders its own `<html>`/`<body>`, which RTL's default container (a `div`
 * appended to `document.body`) cannot legally hold. happy-dom tolerates the nesting well enough
 * to assert on the document shell's own attributes and top-level text; the actual accessible
 * content is tested separately, through `GlobalErrorContent`, via `renderSurface`.
 */
function renderGlobal(ui: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  return render(ui, { container });
}

const BOOM = Object.assign(new Error('relation "leagues" does not exist'), { digest: "abc123" });

describe("app/error.tsx", () => {
  it("says what happened and offers a way forward, in both themes, axe-clean", async () => {
    await renderSurface(<AppError error={BOOM} reset={() => {}} />, async ({ container }) => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Go to your leagues" })).toHaveAttribute("href", "/app");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  // F14: a Client Component error boundary cannot know whether there is a session, so it always
  // renders the honest chrome for an unknown one rather than guessing.
  it("renders PublicBar unconditionally, since it cannot know whether there is a session", () => {
    renderSurface(<AppError error={BOOM} reset={() => {}} />, ({ getByRole }) => {
      expect(getByRole("link", { name: "Commish" })).toHaveAttribute("href", "/");
      expect(getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    });
  });

  it("never leaks the raw exception text into the page", async () => {
    await renderSurface(<AppError error={BOOM} reset={() => {}} />, ({ container }) => {
      expect(container.textContent).not.toContain("relation");
      expect(container.textContent).not.toContain("does not exist");
    });
  });

  it("shows the digest as a quiet reference so support can find the log line", async () => {
    await renderSurface(<AppError error={BOOM} reset={() => {}} />, () => {
      expect(screen.getByText("Reference abc123")).toBeInTheDocument();
    });
  });

  it("omits the reference line entirely when there is no digest", async () => {
    await renderSurface(<AppError error={new Error("nope")} reset={() => {}} />, ({ container }) => {
      expect(container.textContent).not.toContain("Reference");
    });
  });

  it("calls reset when the retry button is pressed", async () => {
    const reset = vi.fn();
    await renderSurface(<AppError error={BOOM} reset={reset} />, async () => {
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(reset).toHaveBeenCalledTimes(2); // once per theme render
  });
});

describe("app/global-error.tsx", () => {
  // React treats <html> and <body> as host singletons: it always reconciles them against the
  // real document.documentElement/document.body rather than nesting fresh ones inside an RTL
  // container (happy-dom enforces the same one-<html>-per-document rule a real browser does).
  // That puts the actual accessible content out of `renderSurface`/`axe`'s reach if exercised
  // only through the full `GlobalError`, so the two concerns are split: the document-shell
  // attributes are proven here against the real document, and the accessible content — copy,
  // headings, the retry control — is proven below through `GlobalErrorContent`, the same tree
  // `GlobalError` renders inside `<body>`, run through `renderSurface` and `axe` like every
  // other suite in this file.
  it("renders its own document shell with a retry", () => {
    const reset = vi.fn();
    const { container } = renderGlobal(<GlobalError error={BOOM} reset={reset} />);
    expect(document.documentElement).toHaveAttribute("lang", "en");
    expect(document.body.className).toContain("antialiased");
    expect(container.textContent).toContain("Something went wrong on our side.");
    expect(container.textContent).not.toContain("relation");
  });

  it("says what happened and offers a way forward, in both themes, axe-clean", async () => {
    await renderSurface(<GlobalErrorContent error={BOOM} reset={() => {}} />, async ({ container }) => {
      expect(screen.getByRole("heading", { name: "Something went wrong on our side." })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
      expect(container.textContent).not.toContain("relation");
      expect(container.textContent).not.toContain("does not exist");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("calls reset when the retry button is pressed", async () => {
    const reset = vi.fn();
    await renderSurface(<GlobalErrorContent error={BOOM} reset={reset} />, async () => {
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    });
    expect(reset).toHaveBeenCalledTimes(2); // once per theme render
  });
});

describe("app/not-found.tsx", () => {
  it("is an empty state, not an error, and offers both ways on, axe-clean", async () => {
    await renderSurface(await NotFound(), async ({ container }) => {
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/");
      expect(screen.getByRole("link", { name: "Browse open leagues" })).toHaveAttribute("href", "/browse");
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("offers a signed-out visitor somewhere they can actually go", async () => {
    // Today every action on both surfaces points at /app, which for a stranger who followed a bad
    // public link is a bounce straight into hosted sign-in. The way out of a 404 must not require
    // an account.
    renderSurface(await NotFound(), ({ getByRole }) => {
      expect(getByRole("link", { name: "Browse open leagues" })).toHaveAttribute("href", "/browse");
      expect(getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/");
    });
  });

  // F14: same reasoning as `AppError` — renders the honest chrome for an unknown session rather
  // than the "Go to your leagues" bounce a total stranger has no account to follow.
  it("renders PublicBar unconditionally, for the same reason AppError does", async () => {
    renderSurface(await NotFound(), ({ getByRole }) => {
      expect(getByRole("link", { name: "Commish" })).toHaveAttribute("href", "/");
      expect(getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    });
  });
});
