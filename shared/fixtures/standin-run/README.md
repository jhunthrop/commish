# The stand-in run, before the draft

Recorded by web/scripts/record-standin-run.ts from the stand-in run (`npm run standin` in web/, read once
from the dev store), not generated: run both again to refresh it. The apps' Board reads it as its
pre-draft board (Lane 190), the board the web's pre-draft board is built from, in the bucket's layout of
`shared/fixtures/run`, so one reader serves both as the API's run routes answer them.

Each file is the stand-in's, held to the run's schema and to the members the API sends: the manifest's
sources and the designations' source are dropped, and the manifest's `runAt` is moved to
2026-09-01T12:00:00.000Z, before the season's first kickoff. Its board carries every column the
contract run predates: tiers with their drops, the Gap, and the kickers and defenses in draft order.

| File | Route | What it holds |
| --- | --- | --- |
| `runs/latest.json` | none | the latest pointer, naming the stand-in |
| `runs/2026-10-12T00-standin/manifest.json` | `GET /run/manifest` | the run: its one format, PPR for 12 teams, of the full season |
| `runs/2026-10-12T00-standin/boards/ppr-12.json` | `GET /run/boards/ppr-12` | the PPR board, 400 ranked rows and 48 kickers and defenses |
| `runs/2026-10-12T00-standin/adp.json` | `GET /run/adp` | the ADP source and its value per player |
| `runs/2026-10-12T00-standin/clubs.json` | `GET /run/clubs` | the 32 clubs with their byes |
| `runs/2026-10-12T00-standin/designations.json` | `GET /run/designations` | the stand-in's injury capture |
