import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import { AppHeader } from "./app-header";

describe("AppHeader", () => {
  it("names the signed-in user and links to their profile, with their avatar, in both themes, axe-clean", async () => {
    await inBothThemes(<AppHeader displayName="Ada Lovelace" avatar="preset:shield" />, async ({ container }) => {
      const link = screen.getByRole("link", { name: /Ada Lovelace/ });
      expect(link).toHaveAttribute("href", "/app/profile");
      expect(container.querySelector("svg")).not.toBeNull();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("still renders a working profile link and initials fallback with no avatar chosen", () => {
    render(<AppHeader displayName="Ada Lovelace" avatar={null} />);
    expect(screen.getByRole("link", { name: /Ada Lovelace/ })).toHaveAttribute("href", "/app/profile");
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("keeps the wordmark link to /app and a working sign-out form", () => {
    render(<AppHeader displayName="Ada Lovelace" avatar={null} />);
    expect(screen.getByRole("link", { name: "Commish" })).toHaveAttribute("href", "/app");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });
});
