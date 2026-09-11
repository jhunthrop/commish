import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import type { ReviewsPage, ReviewView } from "@/reviews/contract";
import { fixtureAccountDeps, renderInAccount } from "../test-fixtures";
import { AccountRoomDepsProvider } from "../hooks/deps";
import { ReviewFeed } from "./review-feed";
// F15: this feed's neighbor public room (Task 20's other half) — see the "renders the same taken
// panel" test below for why it is asserted here rather than only in `invite-landing.test.tsx`.
import { InviteLanding } from "@/league-room/components/invite-landing";

const REVIEW_A: ReviewView = {
  id: "r-new",
  rating: 1,
  body: "The commissioner vanished mid-season and nobody ever settled the standings.",
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  authorName: "Grace Hopper",
  authorAvatar: null,
  verified: false,
};

const REVIEW_B: ReviewView = {
  id: "r-old",
  rating: 5,
  body: "This league runs itself. Draft night was smooth and scoring settled fast.",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  authorName: "Ada Lovelace",
  authorAvatar: "preset:shield",
  verified: true,
};

const PAGE: ReviewsPage = { reviews: [REVIEW_A, REVIEW_B], hasMore: false, nextBefore: null };
const EMPTY_PAGE: ReviewsPage = { reviews: [], hasMore: false, nextBefore: null };

describe("ReviewFeed", () => {
  it("renders reviews newest-first exactly as given, in both themes, axe-clean", async () => {
    const fixture = fixtureAccountDeps();
    await renderSurface(
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

  it("shows the verified badge only for a reviewer who has actually finished a season here", () => {
    renderInAccount(<ReviewFeed initialPage={PAGE} emptyAction={<span>Write the first review</span>} />, fixtureAccountDeps().deps);
    // REVIEW_B (Ada Lovelace) is verified; REVIEW_A (Grace Hopper) is not.
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getAllByText("Verified")).toHaveLength(1);
  });

  it("renders no badge at all for an unverified reviewer — the inverted case shows nothing, not a negative badge", () => {
    const unverifiedOnly: ReviewsPage = { reviews: [REVIEW_A], hasMore: false, nextBefore: null };
    renderInAccount(<ReviewFeed initialPage={unverifiedOnly} emptyAction={<span>Write the first review</span>} />, fixtureAccountDeps().deps);
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });

  // P7, AND THE FOUNDER'S NO-TIPS RULING: the badge used to carry an `InfoTip` trigger that
  // opened "This reviewer finished at least one full season on Commish." There is no tip to open
  // any more, and none of its scaffolding either: the word on the badge is the whole claim, and
  // `/league-rules` is where the long version lives for anyone who wants it.
  it("offers no tip beside the verified badge, and never a title attribute standing in for one", () => {
    const verifiedOnly: ReviewsPage = { reviews: [REVIEW_B], hasMore: false, nextBefore: null };
    const { container } = renderInAccount(
      <ReviewFeed initialPage={verifiedOnly} emptyAction={<span>Write the first review</span>} />,
      fixtureAccountDeps().deps,
    );
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^What is/ })).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
    expect(container.querySelector("[title]")).toBeNull();
  });

  it("shows a one-star review in the same list as a five-star one — nothing is hidden by rating", () => {
    renderInAccount(<ReviewFeed initialPage={PAGE} emptyAction={<span>Write the first review</span>} />, fixtureAccountDeps().deps);
    expect(screen.getByText(REVIEW_A.body)).toBeInTheDocument();
    expect(screen.getByText(REVIEW_B.body)).toBeInTheDocument();
  });

  // L3: `listReviews` used to render a rating lookup that missed as `?? 0`, which the label
  // turned into "0 out of 5, rated" — a number no author could have chosen, since the scale
  // starts at 1, on the page whose promise is that it shows what people actually said.
  it("renders a review with no rating as having none, never as zero out of five", () => {
    const unrated: ReviewsPage = { reviews: [{ ...REVIEW_A, rating: null }], hasMore: false, nextBefore: null };
    renderInAccount(<ReviewFeed initialPage={unrated} emptyAction={<span>Write the first review</span>} />, fixtureAccountDeps().deps);

    expect(screen.queryByText(/out of 5/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 out of 5/)).not.toBeInTheDocument();
    // Everything else about the review still renders — the rating is absent, not the review.
    expect(screen.getByText(REVIEW_A.body)).toBeInTheDocument();
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(document.querySelectorAll("time")).toHaveLength(1);
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

  // A4. The founder's claim is that these are unedited, good and bad. A "highest rated" control
  // would make that claim false while leaving every review technically present.
  it("offers no way to reorder or filter what people said", () => {
    renderSurface(<ReviewFeed initialPage={PAGE} emptyAction={null} />, ({ queryByRole }) => {
      expect(queryByRole("button", { name: /sort|filter|highest|helpful/i })).toBeNull();
    });
  });

  // C1 (ruled): the expanded register is the house standard, stated in docs/design-system.md by
  // the parent's Task 14 Step 2. "isn't" becomes "is not" here, in the task that owns the string.
  // Stated once for the whole feed (Task 20 Step 1) rather than gated behind opening any one
  // row's report control, so a reader can see the boundary without starting the report flow.
  it("says what reporting a review does and does not do", () => {
    renderSurface(<ReviewFeed initialPage={PAGE} emptyAction={null} />, ({ getByText }) => {
      expect(getByText("Report reviews that break the rules. Disagreeing with a rating is not a reason to report it.")).toBeInTheDocument();
    });
  });

  // E9 (Task 10): "Report" used to render as its own left-aligned line below the body — a fourth
  // thing on the page rather than a control attached to the review above it. Proves both halves:
  // it sits inside the SAME hairline-bounded row as the review it reports (the shared `<li>`),
  // and that row pins it to the trailing edge rather than the leading one.
  it("keeps Report right-aligned inside its own review's row, attached to what it reports", () => {
    renderInAccount(<ReviewFeed initialPage={PAGE} emptyAction={<span>Write the first review</span>} />, fixtureAccountDeps().deps);
    const reportButtons = screen.getAllByRole("button", { name: "Report" });
    expect(reportButtons).toHaveLength(2);

    const firstRow = reportButtons[0]!.closest("li");
    expect(firstRow).not.toBeNull();
    expect(firstRow).toHaveTextContent(REVIEW_A.authorName);
    expect(firstRow).toHaveTextContent(REVIEW_A.body);
    expect(reportButtons[0]!.parentElement).toHaveClass("justify-end");

    const secondRow = reportButtons[1]!.closest("li");
    expect(secondRow).not.toBe(firstRow);
    expect(secondRow).toHaveTextContent(REVIEW_B.authorName);
    expect(secondRow).toHaveTextContent(REVIEW_B.body);
  });

  it("shows the reason select once the control opens", () => {
    renderInAccount(<ReviewFeed initialPage={PAGE} emptyAction={<span>Write the first review</span>} />, fixtureAccountDeps().deps);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Report" })[0]!);
    expect(screen.getAllByRole("combobox")[0]).toBeInTheDocument();
  });

  // F15: an invited friend who arrives one minute late was getting a second, worse copy of the
  // race loser. `SeatTakenPanel` takes its two actions as props precisely so the invite landing
  // can give a private league's invitee the actions that make sense there, not the shelf's own —
  // proven here by rendering the SAME component this feed's neighbor public room renders.
  it("renders the same taken panel the shelf does when the league filled first", () => {
    renderSurface(<InviteLanding state={{ kind: "league-full", name: "Bay Bandits" }} />, ({ getByTestId, getByRole }) => {
      expect(getByTestId("seat-taken-panel")).toBeInTheDocument();
      expect(getByRole("link", { name: "Browse open leagues" })).toBeInTheDocument();
    });
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
