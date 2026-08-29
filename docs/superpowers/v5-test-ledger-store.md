# Sunday v5 — the storefront remainder: test ledger

**Track:** the storefront remainder (`/browse` head, `/league-rules`, `/reviews`, `/support`,
`/legal/terms`, `/legal/privacy`, `/sign-in/problem`, the 404, and the reading frame they share).
**Branch:** `worktree-v5-store`.
**Tests are DEFERRED for this campaign** by the track brief: no `vitest` run. `tsc --noEmit` clean
on production files is the per-commit gate, plus `eslint` on every touched path, plus the spec's
own execution doctrine — **the acceptance criterion is a screenshot**, taken from this worktree's
own dev server on port 3014, both themes, 1440 and 390.

## What was actually run, per commit

| Commit | `tsc --noEmit` | `eslint` | Screenshots |
|---|---|---|---|
| `acfc37b` the lobby head goes broadcast | clean on production files | clean on `src/app/browse`, `browse-filters.tsx` | `/browse` dark+light, 1440+390 |
| `34a063f` the reference carries every word | clean on production files | clean on `src/app/league-rules`, `reading-frame.tsx` | `/league-rules` dark+light, 1440+390 |
| the storefront sweep | clean on production files | clean on `src/app` | all eight surfaces, dark+light, 1440+390 |

**The one standing `tsc` failure is not this track's**, and is recorded here so the next person
does not chase it: `src/league-room/components/league-row.test.tsx` and
`league-row.hydration.test.tsx` do not pass `position`, which `LeagueRow` made required when the
board became a ranked tower. Both are TEST files owned by the board track, both predate this
branch, and the production sweep (`tsc --noEmit` filtered to non-test files) is clean.

## Tests that were TOUCHED but not run

Three test files were edited because leaving them stale would have been a lie in source, not
because they were executed:

- `src/app/league-rules/glossary-section.test.tsx` — the old assertion was
  `expect(LEAGUE_RULES_GLOSSARY_TERMS).toHaveLength(7)`. A count passes the moment somebody swaps
  one term for another, and seven is no longer the right number anyway. Replaced with set equality
  against `Object.keys(GLOSSARY)` in both directions, which is the gate the no-tips ruling actually
  needs: a term added to the registry and forgotten on the page now fails loudly instead of going
  undefined product-wide.
- `src/help/glossary.source.test.ts` — `UNSURFACED` held `playoffs`, waiting for exactly the
  bracket section this track wrote. That file's own reverse assertion requires the entry to be
  deleted in the commit that wires the term, so it was.
- `src/design/accent-budget.source.test.ts` — `browse-filters.tsx` added to the accent-fill
  allowlist, in review with a reason, which is the procedure that file documents for earning one.

**None of the three has been executed.** Whoever runs the suite next should expect these three to
be the first place a failure lands.

## Not closed

- **No signed-in variant of any surface was rendered.** Every page here is public and was verified
  signed out. Minting a session writes to the shared dev Postgres, which the brief forbids, so
  `/browse`'s and `/reviews`'s `AppShell` branches — including the lower third rendered inside
  `AppShell`'s own gutter rather than full-bleed — are unverified by screenshot.
- **`PublicBar` hides the storefront nav below `sm`.** A stranger who lands on `/support` from a
  search result on a phone still has only the wordmark and the footer, which is the exact defect
  `STOREFRONT_NAV` was created to fix, unfixed at 390. `public-bar.tsx` belongs to the shell track.
- **`PublicFooter` still labels `/league-rules` as "League rules"**, a third name for a page whose
  `<h1>`, `metadata` title and rail entry all read "How it works". `/support`'s own link was
  repointed here; the footer's was not, because that file is the shell track's.
- **`e2e/page-audit.spec.ts` and `e2e/whole-site.spec.ts` were not run.** Both name
  `/league-rules` and both assert against its heading, which is unchanged ("How it works"), but
  the page grew eight `<h2>`s and a heading-order assertion is exactly the kind that notices.
