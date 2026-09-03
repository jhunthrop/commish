import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Route-level: proves the page's own gate and its states without a real Postgres connection —
// every read the page makes is mocked, the `admin/queue/page.test.tsx` discipline.
vi.mock("@/lib/auth/current-user", () => ({ requireAdmin: vi.fn() }));
// `notFound()` stays REAL (the 404 gate test asserts its digest); only `useRouter` is faked, so
// the client `JobRerunControl` can render outside a mounted app router.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/jobs/admin-view", () => ({ deadLetterJobs: vi.fn(), recentRuns: vi.fn(), scheduleStatuses: vi.fn() }));

import { requireAdmin } from "@/lib/auth/current-user";
import { deadLetterJobs, recentRuns, scheduleStatuses } from "@/jobs/admin-view";
import AdminJobsPage from "./page";

const OPERATOR = {
  id: "u_op",
  email: "u_op@test.local",
  displayName: "Op Erator",
  experienceTier: "beginner" as const,
  avatarUrl: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  isAdmin: true,
};

const DEAD_ROW = {
  jobId: 7,
  name: "season-week",
  status: "failed" as const,
  attempts: 5,
  maxAttempts: 5,
  lastError: "freeze refused by the register: week has already begun",
  finishedAt: "2026-09-10T14:00:00.000Z",
  scheduleName: "season-week-thu-freeze",
  scheduledFor: "2026-09-10T18:00:00.000Z",
};

const SCHEDULE_ROW = {
  name: "season-week-tue-data",
  cron: "0 8 * * 2",
  timezone: "America/New_York",
  job: "season-week",
  description: "Tuesday 08:00 ET data pass.",
  cursor: "2026-09-08T12:30:00.000Z",
  lastFire: { at: "2026-09-08T12:00:00.000Z", jobId: 7, jobStatus: "succeeded" },
};

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset().mockResolvedValue(OPERATOR);
  vi.mocked(deadLetterJobs).mockReset().mockResolvedValue([]);
  vi.mocked(scheduleStatuses).mockReset().mockResolvedValue([]);
  vi.mocked(recentRuns).mockReset().mockResolvedValue([]);
});

describe("AdminJobsPage — the gate", () => {
  it("404s a signed-in non-operator, never 403", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Not an operator."));
    await expect(AdminJobsPage()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(vi.mocked(deadLetterJobs)).not.toHaveBeenCalled();
  });
});

describe("AdminJobsPage — the states", () => {
  it("shows the all-clear empty states when nothing has run", async () => {
    render(await AdminJobsPage());
    expect(screen.getByText("Nothing needs attention. No job has failed terminally.")).toBeInTheDocument();
    expect(screen.getByText("No runs yet. The runner has not worked any jobs.")).toBeInTheDocument();
  });

  it("puts a dead letter at the top with its error and a re-run action", async () => {
    vi.mocked(deadLetterJobs).mockResolvedValue([DEAD_ROW]);
    vi.mocked(scheduleStatuses).mockResolvedValue([SCHEDULE_ROW]);
    render(await AdminJobsPage());

    expect(screen.getByText("season-week #7")).toBeInTheDocument();
    expect(screen.getByText(/week has already begun/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run again" })).toBeInTheDocument();
    expect(screen.getByText("0 8 * * 2 (America/New_York)")).toBeInTheDocument();
  });
});
