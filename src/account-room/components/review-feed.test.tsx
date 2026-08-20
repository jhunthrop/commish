import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { inBothThemes } from "@/components/ui/test-utils";
import type { ReviewsPage, ReviewView } from "@/reviews/contract";
import { fixtureAccountDeps, renderInAccount } from "../test-fixtures";
import { AccountRoomDepsProvider } from "../hooks/deps";
import { ReviewFeed } from "./review-feed";

const REVIEW_A: ReviewView = {
  id: "r-new",
  rating: 1,
  body: "The commissioner vanished mid-season and nobody ever settled the standings.",
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  authorName: "Grace Hopper",
  authorAvatar: null,
};

const REVIEW_B: ReviewView = {
  id: "r-old",
  rating: 5,
  body: "This league runs itself. Draft night was smooth and scoring settled fast.",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  authorName: "Ada Lovelace",
  authorAvatar: "preset:shield",
};

const PAGE: ReviewsPage = { reviews: [REVIEW_A, REVIEW_B], hasMore: false, nextBefore: null };
const EMPTY_PAGE: ReviewsPage = { reviews: [], hasMore: false, nextBefore: null };

describe("ReviewFeed", () => {
  it("renders reviews newest-first exactly as given, in both themes, axe-clean", async () => {
    const fixture = fixtureAccountDeps();
    await inBothThemes(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <ReviewFeed initialPage={PAGE} emptyAction={<span>Write the first review</span>} />
      </AccountRoomDepsProvider>,
      async ({ container }) => {
        const names = screen.getAllByText(/Hopper|Lovelace/).map((node) => node.textContent);
        expect(names).toEqual(["Grace Hopper", "Ada Lovelace"]);
        expect(screen.getByText(/1 out of 5, poor/)).toBeInTheDocument();
        expect(screen.getByText(/5 out of 5, excellent/)).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("shows a one-star review in the same list as a five-star one — nothing is hidden by rating", () => {
    renderInAccount(<ReviewFeed initialPage={PAGE} emptyAction={<span>Write the first review</span>} />, fixtureAccountDeps().deps);
    expect(screen.getByText(REVIEW_A.body)).toBeInTheDocument();
    expect(screen.getByText(REVIEW_B.body)).toBeInTheDocument();
  });

  it("renders each review's date as a screen-reader-friendly <time> element", () => {
    renderInAccount(<ReviewFeed initialPage={PAGE} emptyAction={<span>Write the first review</span>} />, fixtureAccountDeps().deps);
    const times = document.querySelectorAll("time");
    expect(times).toHaveLength(2);
    expect(times[0]).toHaveAttribute("dateTime", REVIEW_A.createdAt);
    expect(times[0]?.textContent).toBe(new Date(REVIEW_A.createdAt).toLocaleDateString());
    expect(times[1]).toHaveAttribute("dateTime", REVIEW_B.createdAt);
    expect(times[1]?.textContent).toBe(new Date(REVIEW_B.createdAt).toLocaleDateString());
  });

  it("invites reviewing Commish itself in the empty state, not a specific league", () => {
    renderInAccount(<ReviewFeed initialPage={EMPTY_PAGE} emptyAction={<span>Write the first review</span>} />, fixtureAccountDeps().deps);
    expect(screen.getByText("No reviews yet")).toBeInTheDocument();
    expect(screen.getByText("Be the first to say what Commish is like to use.")).toBeInTheDocument();
    expect(screen.getByText("Write the first review")).toBeInTheDocument();
  });

  it("shows Show more only when hasMore is true, and loads the next page on click", async () => {
    const page: ReviewsPage = { reviews: [REVIEW_A], hasMore: true, nextBefore: REVIEW_A.createdAt };
    const fixture = fixtureAccountDeps({ ok: true, data: { reviews: [REVIEW_B], hasMore: false, nextBefore: null } });
    renderInAccount(<ReviewFeed initialPage={page} emptyAction={<span>Write the first review</span>} />, fixture.deps);

    expect(screen.getByRole("button", { name: "Show more" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));

    await waitFor(() => expect(fixture.calls).toEqual([`GET /api/reviews?before=${encodeURIComponent(REVIEW_A.createdAt)}`]));
    expect(await screen.findByText(REVIEW_B.body)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("does not render Show more when hasMore is false", () => {
    renderInAccount(<ReviewFeed initialPage={PAGE} emptyAction={<span>Write the first review</span>} />, fixtureAccountDeps().deps);
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("explains report scope alongside the reason select once the control opens", () => {
    renderInAccount(<ReviewFeed initialPage={PAGE} emptyAction={<span>Write the first review</span>} />, fixtureAccountDeps().deps);
    expect(screen.queryByText(/break the rules/)).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Report" })[0]!);
    expect(
      screen.getByText("Report reviews that break the rules. Disagreeing with a rating isn't a reason to report it."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("combobox")[0]).toBeInTheDocument();
  });

  it("has a Report control per row that sends a reason and confirms once sent", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: { reported: true } });
    renderInAccount(<ReviewFeed initialPage={PAGE} emptyAction={<span>Write the first review</span>} />, fixture.deps);

    const reportButtons = screen.getAllByRole("button", { name: "Report" });
    fireEvent.click(reportButtons[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Send report" })[0]!);

    await waitFor(() => expect(fixture.calls).toEqual([`POST /api/reviews/${REVIEW_A.id}/report`]));
    expect(await screen.findByText("Reported. Thank you.")).toBeInTheDocument();
  });

  it("shows the server's reason when a report fails, without crashing", async () => {
    const fixture = fixtureAccountDeps({ ok: false, error: "Not signed in." });
    renderInAccount(<ReviewFeed initialPage={PAGE} emptyAction={<span>Write the first review</span>} />, fixture.deps);
    fireEvent.click(screen.getAllByRole("button", { name: "Report" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Send report" })[0]!);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Not signed in."));
  });
});
