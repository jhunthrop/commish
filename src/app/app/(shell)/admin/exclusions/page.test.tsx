import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";

vi.mock("@/lib/auth/current-user", () => ({ requireAdmin: vi.fn() }));

import { requireAdmin } from "@/lib/auth/current-user";
import AdminExclusionsPage from "./page";

const OPERATOR = { id: "u_op", email: "u_op@test.local", displayName: "Op Erator", experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-01T00:00:00.000Z", isAdmin: true };

function callPage() {
  return AdminExclusionsPage();
}

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset().mockResolvedValue(OPERATOR);
});

describe("AdminExclusionsPage — the gate", () => {
  it("404s a signed-in non-operator, never 403", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Not an operator."));
    await expect(callPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
});

describe("AdminExclusionsPage — rendering", () => {
  it("renders the clear-exclusion form for an operator, in both themes, axe-clean", async () => {
    const page = await callPage();
    await renderSurface(page, async ({ container }) => {
      expect(screen.getByText("Self exclusion")).toBeInTheDocument();
      expect(screen.getByLabelText("Member user id")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it("never fetches anything on render — the control only calls out on submit", async () => {
    const page = await callPage();
    render(page);
    expect(screen.getByRole("button", { name: "Clear self exclusion" })).toBeInTheDocument();
  });
});
