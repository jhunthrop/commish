import { getDb } from "@/db/client";
import { getCurrentUser } from "@/lib/auth/current-user";
import { readPreferences } from "@/identity-service/preferences";
import { PageTitle } from "@/components/ui";
import { PublicBar } from "@/components/app-shell/public-bar";
import { PublicFooter } from "@/components/app-shell/public-footer";
import { invitePreview } from "@/league-service/invites";
import { InviteLanding, type InviteLandingState } from "@/league-room/components/invite-landing";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ readonly code: string }>;
}

/**
 * Duplicated from `@/league-service/invites`'s own three refusal constants (`INVALID`,
 * `EXPIRED`, `EXHAUSTED`) — none of the three is exported, on purpose (see that module's own
 * docblock), so this is the only way a caller outside it can tell them apart; `InviteLanding`'s
 * own copy of the same three sentences (used for DISPLAY, not matching) carries the identical
 * duplication note. A5 (Phase 3.6 addendum) requires the words stay byte-identical to that
 * module's own — they do, verified against that file. A future fourth refusal there fails safe
 * here (as "invalid") rather than throwing.
 */
const DEAD_CODE_KIND_BY_TEXT: Readonly<Record<string, "invalid" | "expired" | "exhausted">> = {
  "That invite link is not valid. Ask your commissioner for a new one.": "invalid",
  "That invite link has expired. Ask your commissioner for a new one.": "expired",
  "That invite link has already been used up. Ask your commissioner for a new one.": "exhausted",
};

function stateFor(preview: Awaited<ReturnType<typeof invitePreview>>): InviteLandingState {
  if (preview.ok) return { kind: "open", terms: preview.terms };
  return { kind: DEAD_CODE_KIND_BY_TEXT[preview.reason] ?? "invalid" };
}

/**
 * The shareable invite link's destination, and the ONE page under `/app` a signed-out visitor
 * reaches (`middleware.ts`'s single exemption, whose docblock states how tightly it is scoped).
 *
 * Lives in the `(public)` route group (Task 2), a sibling of `(shell)`: this segment DECLINES
 * `(shell)/layout.tsx`'s `AppShell` entirely — a signed-in shell around a page a stranger can
 * land on unauthenticated would be chrome nobody signed out can use, and the rail's own leagues
 * would be somebody's private list drawn beside a link anyone with the URL can open. A route
 * group changes no URL, so `/app/join/[code]` still resolves exactly as every existing invite
 * link expects.
 *
 * Phase 3.6, Task 20: `invitePreview` is now called HERE, server-side, once — the addendum's
 * `InviteLanding` (`@/league-room/components/invite-landing`) takes the resolved
 * `InviteLandingState` as a prop rather than fetching its own preview the way `JoinForm` used to.
 * That is what makes `GET /api/invites/[code]`'s documented unauthenticated ruling TRUE rather
 * than aspirational: the record says a prospect sees what they are joining "before holding an
 * account", and a server-rendered preview is what makes that true on the very first byte, signed
 * out, with no client round trip in between. Signed out, the terms render and the action is a
 * plain "Sign in" — the same idiom `PublicLeagueList` uses on `/browse`. Signed in, still no
 * shell renders here — `PublicBar` (Task 16) is the SIGNED-OUT chrome, so it renders only when
 * `user === null`, the same conditional the header always used; `PublicFooter` renders
 * regardless of session, because this route never gets `AppShell`'s own chrome either way and a
 * footer's trust links cost a signed-in visitor nothing.
 *
 * `readPreferences` (the same seed-on-first-read call the league home page makes) only runs when
 * there IS a caller: a signed-out visitor has no preferences row and must not seed one. Their
 * `InfoTip`s open `guided` unconditionally, exactly as `/browse`'s do and for the same reason —
 * a stranger deciding whether to join benefits most from more explanation, not less.
 */
export default async function JoinPage({ params }: PageProps) {
  const [user, { code }] = await Promise.all([getCurrentUser(), params]);
  const [preferences, preview] = await Promise.all([
    user === null ? Promise.resolve(null) : readPreferences(getDb(), user),
    invitePreview(getDb(), code),
  ]);
  // This page's own current path — its `PublicBar`'s sign-in link and `InviteLanding`'s own
  // `SignInLink` both return here (Task 16, F6).
  const pageIntent = `/app/join/${code}`;

  return (
    <>
      {user === null ? <PublicBar intent={pageIntent} /> : null}
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 p-4">
        <PageTitle>Join a league</PageTitle>
        <InviteLanding state={stateFor(preview)} signedIn={user !== null} code={code} helpLevel={preferences?.helpLevel ?? "guided"} />
      </main>
      <PublicFooter />
    </>
  );
}
