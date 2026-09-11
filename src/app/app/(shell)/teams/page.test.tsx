import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Route-level: the page's own gate and what it hands the shelf. There is no DB-backed call to
// stub — the club list is a constant (`clubIndex`), which is half the point of the page.
vi.mock("@/lib/auth/current-user", () => ({ requireCurrentUser: vi.fn() }));

import { requireCurrentUser } from "@/lib/auth/current-user";
import TeamsIndexPage from "./page";

const USER = { id: "u1", email: "u1@test.local", displayName: "Ada Lovelace", experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-01T00:00:00.000Z", isAdmin: false };

beforeEach(() => {
  vi.mocked(requireCurrentUser).mockResolvedValue(USER);
});

describe("TeamsIndexPage", () => {
  it("serves the shelf of all 32 clubs, each linking at its own page", async () => {
    render(await TeamsIndexPage());
    expect(screen.getByRole("heading", { level: 1, name: "Teams" })).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(32);
    expect(screen.getByRole("link", { name: /Lions/ })).toHaveAttribute("href", "/app/teams/DET");
  });

  it("refuses a caller with no session, before rendering anything", async () => {
    vi.mocked(requireCurrentUser).mockRejectedValue(new Error("no session"));
    await expect(TeamsIndexPage()).rejects.toThrow("no session");
  });
});
