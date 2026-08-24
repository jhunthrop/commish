import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import SignInProblemPage from "./page";

describe("SignInProblemPage", () => {
  it("says what happened in plain language, with a way back in and a way to the front door, axe-clean", async () => {
    const page = await SignInProblemPage({ searchParams: Promise.resolve({}) });
    const { container } = render(page);

    expect(screen.getByText("Sign-in did not go through")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/sign-in");
    expect(screen.getByRole("link", { name: "Go to the front door" })).toHaveAttribute("href", "/");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("never prints a digest, an error message, or a provider name", async () => {
    const page = await SignInProblemPage({ searchParams: Promise.resolve({}) });
    const { container } = render(page);

    expect(container.textContent).not.toMatch(/digest/i);
    expect(container.textContent).not.toMatch(/workos/i);
    expect(container.textContent).not.toMatch(/error:/i);
  });

  it("carries a trustworthy returnTo through to the try-again link, via safeReturnTo", async () => {
    const page = await SignInProblemPage({ searchParams: Promise.resolve({ returnTo: "/join/lg_bandits/hold" }) });
    render(page);

    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute(
      "href",
      "/sign-in?returnTo=%2Fjoin%2Flg_bandits%2Fhold",
    );
  });

  it("refuses a hostile returnTo and falls back to a plain sign-in", async () => {
    const page = await SignInProblemPage({ searchParams: Promise.resolve({ returnTo: "https://evil.example" }) });
    render(page);

    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", "/sign-in");
  });

  it("renders the product's own chrome — PublicBar and PublicFooter — rather than a bare error page", async () => {
    const page = await SignInProblemPage({ searchParams: Promise.resolve({}) });
    render(page);

    expect(screen.getByRole("link", { name: "Commish" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/legal/terms");
  });
});
