# Sunday v5 — season surfaces: knowingly-broken test files

Tests are DEFERRED for the v5 route conversion. This file is the record of what the conversion
broke, one line each, so the pass that re-greens the suite has a list rather than a search.

Inherited from `main` (broken before this branch, listed so nobody re-diagnoses them):

- `src/league-room/components/league-row.test.tsx` — `position` became a required prop on `LeagueRow`.
- `src/league-room/components/league-row.hydration.test.tsx` — same required `position` prop.

Broken by this branch:
