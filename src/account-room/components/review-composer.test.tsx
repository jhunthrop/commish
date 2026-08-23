import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import { renderSurface } from "@/components/ui/test-utils";
import { REVIEW_CONFIG } from "@/reviews/config";
import type { MyReviewState, ReviewView } from "@/reviews/contract";
import { fixtureAccountDeps, renderInAccount } from "../test-fixtures";
import { AccountRoomDepsProvider } from "../hooks/deps";
import { ReviewComposer } from "./review-composer";

const EXISTING: ReviewView = {
  id: "r1",
  rating: 4,
  body: "A solid league with fair scoring and a commissioner who actually shows up.",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  authorName: "Ada Lovelace",
  authorAvatar: null,
  verified: false,
};

const NONE: MyReviewState = { state: "none" };

const LONG_ENOUGH = "This league runs itself. Draft night was smooth and scoring settled fast.";

describe("ReviewComposer", () => {
  it("has a rating radio group labeled in words and a review textarea, in both themes, axe-clean", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: EXISTING });
    await renderSurface(
      <AccountRoomDepsProvider deps={fixture.deps}>
        <ReviewComposer myReview={NONE} />
      </AccountRoomDepsProvider>,
      async ({ container }) => {
        expect(screen.getByRole("radiogroup", { name: "Rating" })).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "1, poor" })).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "5, excellent" })).toBeInTheDocument();
        expect(screen.getByLabelText("Your review")).toBeInTheDocument();
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  });

  it("invites reviewing Commish itself, not a specific league or commissioner", () => {
    renderInAccount(<ReviewComposer myReview={NONE} />, fixtureAccountDeps().deps);
    expect(
      screen.getByText(`Tell other managers what using Commish is like. At least ${REVIEW_CONFIG.body.minLength} characters.`),
    ).toBeInTheDocument();
  });

  it("says nothing about an existing review when there isn't one, and posts the review", async () => {
    const fixture = fixtureAccountDeps({ ok: true, data: { ...EXISTING, rating: 5, body: LONG_ENOUGH } });
    renderInAccount(<ReviewComposer myReview={NONE} />, fixture.deps);
    expect(screen.queryByText(/already left a review/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "5, excellent" }));
    fireEvent.change(screen.getByLabelText("Your review"), { target: { value: LONG_ENOUGH } });
    fireEvent.click(screen.getByRole("button", { name: "Post review" }));

    await waitFor(() => expect(fixture.calls).toEqual(["POST /api/reviews"]));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("says an existing review will be replaced, pre-fills it, and shows Save changes", () => {
    renderInAccount(<ReviewComposer myReview={{ state: "live", review: EXISTING }} />, fixtureAccountDeps().deps);
    expect(screen.getByText("You've already left a review. Editing replaces it.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "4, very good" })).toBeChecked();
    expect(screen.getByLabelText("Your review")).toHaveValue(EXISTING.body);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("shows a removed author the reason and no form at all, with a way back to the feed", () => {
    const fixture = fixtureAccountDeps();
    renderInAccount(
      <ReviewComposer myReview={{ state: "removed", reason: "spam", removedAt: "2026-08-04T00:00:00.000Z" }} />,
      fixture.deps,
    );

    // The STORED value is the closed vocabulary's `"spam"`; what the author reads is its
    // `removalPhrase`, so the sentence is a sentence.
    expect(screen.getByText("Your review was removed for spam or fake content. It can't be edited.")).toBeInTheDocument();
    // No editable form anywhere: the server refuses this author's write (`submitReview`'s
    // `setWhere`), so offering a textarea and a Save button would be a promise it will break.
    expect(screen.queryByLabelText("Your review")).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Rating" })).not.toBeInTheDocument();
    expect(screen.queryByText(/already left a review/)).not.toBeInTheDocument();
    // Not a dead end.
    expect(screen.getByRole("link", { name: "Read what other managers are saying" })).toHaveAttribute("href", "/reviews");
  });

  it("blocks submit and explains why when no rating is chosen", async () => {
    const fixture = fixtureAccountDeps();
    renderInAccount(<ReviewComposer myReview={NONE} />, fixture.deps);
    fireEvent.change(screen.getByLabelText("Your review"), { target: { value: LONG_ENOUGH } });
    fireEvent.click(screen.getByRole("button", { name: "Post review" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Choose a rating."));
    expect(fixture.calls).toEqual([]);
  });

  it("blocks submit and explains why the body is too short, reading validateReviewDraft's own message", async () => {
    const fixture = fixtureAccountDeps();
    renderInAccount(<ReviewComposer myReview={NONE} />, fixture.deps);
    fireEvent.click(screen.getByRole("radio", { name: "3, good" }));
    fireEvent.change(screen.getByLabelText("Your review"), { target: { value: "too short" } });
    fireEvent.click(screen.getByRole("button", { name: "Post review" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(`Say a little more, at least ${REVIEW_CONFIG.body.minLength} characters.`),
    );
    expect(fixture.calls).toEqual([]);
  });

  it("shows the server's reason without losing what was typed", async () => {
    const fixture = fixtureAccountDeps({ ok: false, error: "You've changed that a lot in a short time. Give it a minute and try again." });
    renderInAccount(<ReviewComposer myReview={NONE} />, fixture.deps);
    fireEvent.click(screen.getByRole("radio", { name: "2, fair" }));
    fireEvent.change(screen.getByLabelText("Your review"), { target: { value: LONG_ENOUGH } });
    fireEvent.click(screen.getByRole("button", { name: "Post review" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Give it a minute and try again."));
    expect(screen.getByLabelText("Your review")).toHaveValue(LONG_ENOUGH);
  });

  it("calls onSubmitted with the server's review on success", async () => {
    const submitted = vi.fn();
    const fixture = fixtureAccountDeps({ ok: true, data: { ...EXISTING, rating: 5, body: LONG_ENOUGH } });
    renderInAccount(<ReviewComposer myReview={NONE} onSubmitted={submitted} />, fixture.deps);
    fireEvent.click(screen.getByRole("radio", { name: "5, excellent" }));
    fireEvent.change(screen.getByLabelText("Your review"), { target: { value: LONG_ENOUGH } });
    fireEvent.click(screen.getByRole("button", { name: "Post review" }));
    await waitFor(() => expect(submitted).toHaveBeenCalledWith(expect.objectContaining({ rating: 5 })));
  });

  it("disables the button while the request is in flight", async () => {
    const fixture = fixtureAccountDeps();
    fixture.deps = { ...fixture.deps, fetchJson: () => new Promise(() => {}) };
    renderInAccount(<ReviewComposer myReview={NONE} />, fixture.deps);
    fireEvent.click(screen.getByRole("radio", { name: "3, good" }));
    fireEvent.change(screen.getByLabelText("Your review"), { target: { value: LONG_ENOUGH } });
    fireEvent.click(screen.getByRole("button", { name: "Post review" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Post review" })).toBeDisabled());
  });
});
