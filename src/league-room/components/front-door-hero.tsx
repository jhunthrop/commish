/**
 * The front door's hero (Phase 3.6, Task 5, Step 2) — the mock's own copy (`v2-front-door.html`),
 * with the gauntlet's two fixes applied: the subhead's em dash is gone (the repo's own copy
 * sweep refuses one anywhere in rendered text), and the money question — a visitor who searched
 * for what this costs deserves an answer, not silence that reads as an omission — is answered in
 * its own sentence rather than folded into a longer one, so it is the one line a skimming
 * stranger cannot miss.
 *
 * No props: every word here is static marketing copy, never a fact this task could get wrong by
 * quoting stale data — the numbers that CAN be checked live in `ProofStrip`, right below this.
 */
export function FrontDoorHero() {
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="max-w-3xl font-display text-display-xl font-bold leading-display text-text-primary">
        Real leagues. Real seats. Pick one and you are drafting this week.
      </h1>
      <p className="max-w-2xl text-lg text-text-muted">
        Season-long fantasy football with a live draft room, real-time scoring, and a platform
        that runs the league so no brother-in-law has to. Browse the open leagues
        below. No account is needed to look.
      </p>
      <p className="text-lg font-medium text-text-primary">Every league is free this season.</p>
    </div>
  );
}
