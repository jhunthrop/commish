"""THE PIPELINE (phase A): every ingest the research core runs, ported from the TypeScript core.

One module per source: `nflverse/` (the community releases and the schedule), `tank01/` (the
stats provider and its capture archive), `odds/` (player props), `preseason/` (week-one rosters,
depth charts and the published boards), `coaches.py` (the play-caller seed), `crosswalk.py` (the
two id spaces joined) and `vegas.py` (win totals). Each ingest is a pure mapping from fetched
input to typed rows plus a thin writer, and reaches the network only through `http.Fetcher`.
`python -m research.pipeline <ingest>` runs one against DATABASE_URL.
"""
