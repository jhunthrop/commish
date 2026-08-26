import Link from "next/link";
import { buttonClassName } from "@/components/ui";

/**
 * The practice lobby's own path — the SAME literal `DraftRoom`'s own `MOCK_LOBBY_PATH`
 * (`@/draft-room/components/draft-room.tsx`) names, duplicated rather than imported:
 * `src/league-room/**` and `src/draft-room/**` are sibling client-room directories, neither one
 * importing from the other, and one shared route literal is not a reason to open that door.
 * Task 9 is what makes this path a real page.
 */
const MOCK_LOBBY_PATH = "/app/mock-drafts";

export interface PracticeEntryLinkProps {
  readonly signedIn: boolean;
  readonly className?: string;
}

/**
 * The front door's and browse's one quiet invitation into the practice lobby (Task 9, Step 1).
 * Rule 5: the ink pill stays on the real product's own primary action ("Take a seat" on the
 * front door, a league's own Join on browse) — this is always the quiet outlined pill
 * (`variant="secondary"`), never ink, on every surface it appears.
 *
 * Signed in, it goes straight to the lobby. Signed out, it goes through `/sign-up` carrying its
 * own intent (`docs/conventions.md:414`'s intent rule: every sign-in/sign-up entry point carries
 * the visitor's own intent, validated where it redirects — `safeReturnTo`), never `SignInLink`
 * (`@/components/app-shell/sign-in-link`), which is hard-wired to `/sign-in`: a stranger clicking
 * "Try a mock draft" has usually never made an account, and sign-up is that door, sign-in is
 * not. This is the same "dress a different element as a button" exception `SignInLink` itself is
 * (`button.tsx`'s own docblock) — a second one, for the identical reason.
 */
export function PracticeEntryLink({ signedIn, className }: PracticeEntryLinkProps) {
  const href = signedIn ? MOCK_LOBBY_PATH : `/sign-up?returnTo=${encodeURIComponent(MOCK_LOBBY_PATH)}`;
  return (
    <Link href={href} className={buttonClassName("secondary", "md", className)}>
      Try a mock draft
    </Link>
  );
}
