import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * THE DRAFT TAB OPENS ON THE BOARD (the Draft area round, 2026-09-12). There is no landing page
 * between the word Draft and the rankings any more: the Draft HQ page that stood here was a
 * lobby of cards in front of the two surfaces anybody came for, and the founder's own walk said
 * so. `/app/draft` is the nav's destination, and the board's route is where it lands.
 */
export default function DraftArea() {
  redirect("/app/draft/board");
}
