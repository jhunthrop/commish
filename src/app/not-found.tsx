import { ButtonLink } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ReadingFrame } from "@/components/app-shell/reading-frame";

/**
 * A wrong URL is not a failure, so this is still not an `ErrorState`: no `role="alert"`, no
 * apology, no retry (retrying the same missing URL cannot help). Two ways on, because the two
 * things a visitor could have been looking for are a league they are in and a league they might
 * join.
 *
 * GAMEDAY (2026-08-28): the SHAPE changed and the reasoning above did not. It was an `EmptyState`
 * card centred in a `min-h-[60vh]` well — a dashed box floating in the middle of a page with no
 * footer and no way to the rest of the product except the wordmark, which is the most
 * anonymous-looking surface this product had. It is `ReadingFrame` now: the same masthead every
 * storefront reading page wears, the same storefront nav, the same footer. A 404 a stranger hits
 * is a storefront page, and it should look like it belongs to the same company as the one they
 * were trying to reach.
 *
 * Renders no session-dependent chrome beyond `signedIn` (F14, the same reasoning
 * `src/app/error.tsx` states): a 404 catches every unmatched URL, including one a total stranger
 * followed with no account at all. Its own primary action is "Go to the home page" (`/`) rather
 * than `/app`, which used to be a bounce into hosted sign-in for anyone without a session.
 *
 * `intent` is `null`: there is no page here to return a visitor to after they sign in.
 */
export default async function NotFound() {
  const user = await getCurrentUser();
  return (
    <ReadingFrame
      title="We could not find that page."
      kicker="Not found"
      lede="That link may be outdated. The page you were looking for is not here."
      intent={null}
      signedIn={user !== null}
      action={
        <>
          {/* One ink action per view (law 5 keeps this discipline for a page with a single act):
              the escape hatch is the ink pill, the browse alternative the quiet one. */}
          <ButtonLink href="/">Go to the home page</ButtonLink>
          <ButtonLink href="/browse" variant="secondary">
            Browse open leagues
          </ButtonLink>
        </>
      }
    />
  );
}
