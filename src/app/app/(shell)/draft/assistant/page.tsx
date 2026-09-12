import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The Assistant IS NOT A SURFACE ANY MORE (the Draft area round, 2026-09-12). It carried an honest
 * "arriving soon" card and nothing else; the Draft area is the board, the sheet and the mock
 * lobby. The route stays as a redirect rather than a 404 (fix round 1, M1): this address has been
 * in the product's own nav, in a browser history and very possibly in somebody's bookmarks, and
 * the place that answers the question it was asked is the board.
 */
export default function AssistantMoved() {
  permanentRedirect("/app/draft/board");
}
