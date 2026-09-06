import Link from "next/link";
import { Card } from "@/components/ui";
import type { FirstRunPath, FirstRunPlan } from "@/identity";
import { PROFILE_FORM_FIRST_RUN_HEADING, ProfileForm } from "@/account-room/components/profile-form";
import type { ProfileBody } from "@/account-room/contract";
import { CreateLeaguePanel } from "./create-league-panel";
import { JoinLeagueEntry } from "./join-league-entry";
import { PracticeEntryLink } from "./practice-entry-link";

/**
 * The one place the product explains what a season-long league IS — three plain sentences, no
 * jargon, shown only in guided help (`FirstRunPlan.showsExplainer`). `firstRunPlan` (pure,
 * `@/identity/first-run.ts`) only ever signals whether to show it; the words themselves live
 * here, next to the only component that renders them.
 */
/** THE ONE DEFINITION, exported (flow-remediation review E-1): the campaign that built a drift
 *  test for two duplicated formatters had, in the same wave, three hand-typed copies of the one
 *  sentence the whole B1 finding exists to deliver. It lives here, beside its oldest consumer,
 *  and the front door and the rules page import it. */
export const GAME_DEFINITION =
  "A league is a group of managers who draft NFL players, then start the ones they think will " +
  "score most each week. You play one other manager every week of the NFL season. Your team's " +
  "score is whatever your starters do in their real games.";

const FIRST_RUN_EXPLAINER = GAME_DEFINITION;

/**
 * Every path's real, working control — never a link that only describes what the click would
 * do. `path.cta` becomes the visible action text only where there is no other natural one
 * (`browse`, which genuinely navigates elsewhere); `join` and `create` already carry their own
 * working forms with their own submit labels, so repeating `cta` next to them would just be a
 * second, differently-worded button for the same action. Guidance is ordering, never removal:
 * every one of the three is a real, immediately usable control, not a click-to-reveal teaser.
 */
function FirstRunPathAction({ path }: { readonly path: FirstRunPath }) {
  if (path.key === "browse") {
    return (
      <Link href="/browse" className="text-sm font-medium text-accent underline">
        {path.cta}
      </Link>
    );
  }
  if (path.key === "join") {
    return <JoinLeagueEntry />;
  }
  // Task 9: every caller of `FirstRunPanel` lives under `/app`, already signed in — the same
  // reason `WaitingChecklist`'s own practice link (`waiting-room.tsx`) never checks `signedIn`
  // either.
  if (path.key === "practice") {
    return <PracticeEntryLink signedIn={true} />;
  }
  return <CreateLeaguePanel />;
}

/**
 * The zero-leagues fork: `HomeBoard`'s replacement for the old plain `EmptyState`. Renders
 * `plan.paths` in the order `firstRunPlan` chose, each with its real form or link right there —
 * this panel IS create, join and browse, ordered and explained, which is what lets `/app` drop
 * its old always-on wall of the same three things once a manager has zero leagues.
 *
 * `plan === null` renders nothing (Task 17, Step 1's second test) — derived-only, exactly like
 * the parent's attention queue (ruling 11): `HomeBoard` only calls this component while
 * `firstRunPlan` is non-null, which is precisely "this manager has zero leagues", so there is no
 * seen-flag, no column and no snooze to write. Accepting `null` here rather than requiring the
 * caller to branch first keeps that derivation in ONE place (`firstRunPlan` itself) instead of
 * being re-decided at every call site.
 *
 * `profile` is the same `ProfileBody` `/app/profile` reads (Task 17, Step 2): the identity card
 * above the three paths is `ProfileForm` itself, `variant="first-run"`, never a page-local copy
 * of its fields — the founder's centralization rule, which is what Step 1's fourth test protects.
 * A manager who ignores it loses nothing: every field already has a working default, and the
 * three paths below are still real, immediately usable controls (guidance is ordering, never
 * removal, `first-run.ts`'s own existing rule).
 *
 * The `create` path carries `id="create-league"` because `/browse`'s intro line and
 * `OpenLeagueShelf`'s empty state still link straight at that fragment (the returning-manager
 * `StartOrJoinDisclosure`, 2026-09-05, no longer does — its own create section is a button
 * opening the shared sheet, and `CreateLeagueSheetHost`, not an anchor, is what a hash arrival
 * opens there). Nothing here is collapsed, so this anchor only needs somewhere real to land, and
 * it already is one — no hash-driven open-on-load logic of its own to write.
 */
export function FirstRunPanel({ plan, profile }: { readonly plan: FirstRunPlan | null; readonly profile: ProfileBody }) {
  if (plan === null) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">{plan.headline}</h2>
        {plan.showsExplainer ? <p className="mt-2 max-w-prose text-sm text-text-muted">{FIRST_RUN_EXPLAINER}</p> : null}
      </div>
      <div className="flex flex-col gap-4">
        <Card as="section" aria-label={PROFILE_FORM_FIRST_RUN_HEADING} className="flex flex-col gap-3">
          <ProfileForm profile={profile} variant="first-run" />
        </Card>
        {plan.paths.map((path) => (
          <Card
            key={path.key}
            as="section"
            aria-label={path.title}
            id={path.key === "create" ? "create-league" : undefined}
            className="flex flex-col gap-3"
          >
            <div>
              <h3 className="font-medium text-text-primary">{path.title}</h3>
              <p className="text-sm text-text-muted">{path.detail}</p>
            </div>
            <FirstRunPathAction path={path} />
          </Card>
        ))}
      </div>
    </div>
  );
}
