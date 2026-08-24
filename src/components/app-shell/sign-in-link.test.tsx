import { describe, expect, it } from "vitest";
import { renderSurface } from "@/components/ui/test-utils";
import { SignInLink } from "./sign-in-link";

describe("SignInLink", () => {
  it("carries where the visitor is standing, so signing in does not lose their place", () => {
    renderSurface(<SignInLink intent="/join/lg_bandits/hold" />, ({ getByRole }) => {
      expect(getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in?returnTo=%2Fjoin%2Flg_bandits%2Fhold");
    });
  });

  it("falls back to a plain sign-in when there is no intent worth keeping", () => {
    renderSurface(<SignInLink intent={null} />, ({ getByRole }) => {
      expect(getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    });
  });

  it("lets a caller override the label and the accessible name, for a context that needs more than 'Sign in'", () => {
    renderSurface(
      <SignInLink intent="/browse" aria-label="Sign in to join Rookie Snake Room">
        Sign in to join
      </SignInLink>,
      ({ getByRole, getByText }) => {
        expect(getByRole("link", { name: "Sign in to join Rookie Snake Room" })).toHaveAttribute(
          "href",
          "/sign-in?returnTo=%2Fbrowse",
        );
        expect(getByText("Sign in to join")).toBeInTheDocument();
      },
    );
  });
});
