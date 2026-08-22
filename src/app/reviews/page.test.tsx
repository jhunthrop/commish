import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { REVIEW_CONFIG } from "@/reviews/config";
import { fixtureAccountDeps } from "@/account-room/test-fixtures";
import { AccountRoomDepsProvider } from "@/account-room/hooks/deps";
import { NoticesProvider } from "@/components/app-shell/notices-provider";

const forwardedFor = { value: "203.0.113.9" };

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": forwardedFor.value }),
}));
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/review-service/reviews", () => ({ listReviews: vi.fn(), myReview: vi.fn() }));

import { getCurrentUser } from "@/lib/auth/current-user";
import { listReviews, myReview } from "@/review-service/reviews";
import { resetReviewRateLimits } from "@/app/api/reviews/_shared";
import ReviewsPage from "./page";

const EMPTY_PAGE = { reviews: [], hasMore: false, nextBefore: null };

async function renderPage() {
  const page = await ReviewsPage();
  return render(
    <AccountRoomDepsProvider deps={fixtureAccountDeps().deps}>
      <NoticesProvider>{page}</NoticesProvider>
    </AccountRoomDepsProvider>,
  );
}

beforeEach(() => {
  resetReviewRateLimits();
  forwardedFor.value = "203.0.113.9";
  vi.mocked(getCurrentUser).mockReset().mockResolvedValue(null);
  vi.mocked(listReviews).mockReset().mockResolvedValue(EMPTY_PAGE);
  vi.mocked(myReview).mockReset().mockResolvedValue({ state: "none" });
});

/**
 * M3: this page runs the SAME `listReviews` query `GET /api/reviews` does, and the API route was
 * the only door with a limiter on it. Both sides of the threshold, against one shared bucket.
 */
describe("/reviews rate limiting", () => {
  it("renders the feed for every request up to the ceiling", async () => {
    for (let i = 0; i < REVIEW_CONFIG.browseRateLimit.maxRequests; i += 1) {
      const view = await renderPage();
      expect(screen.getByRole("heading", { name: "What managers are saying" })).toBeInTheDocument();
      view.unmount();
    }
    expect(vi.mocked(listReviews)).toHaveBeenCalledTimes(REVIEW_CONFIG.browseRateLimit.maxRequests);
  });

  it("refuses the request past the ceiling and reads nothing at all", async () => {
    for (let i = 0; i < REVIEW_CONFIG.browseRateLimit.maxRequests; i += 1) {
      (await renderPage()).unmount();
    }
    vi.mocked(listReviews).mockClear();

    await renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("Too many requests");
    expect(screen.queryByRole("heading", { name: "What managers are saying" })).not.toBeInTheDocument();
    // The point of guarding BEFORE the query: an over-the-ceiling caller costs zero database work.
    expect(vi.mocked(listReviews)).not.toHaveBeenCalled();
    // Never a dead end.
    expect(screen.getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/");
  });

  it("spends from the same bucket the API route does, keyed per caller", async () => {
    for (let i = 0; i < REVIEW_CONFIG.browseRateLimit.maxRequests; i += 1) {
      (await renderPage()).unmount();
    }
    // A DIFFERENT caller is unaffected by the first one's exhausted budget.
    forwardedFor.value = "198.51.100.4";
    await renderPage();
    expect(screen.getByRole("heading", { name: "What managers are saying" })).toBeInTheDocument();
  });
});
