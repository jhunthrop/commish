"""OUR HEADSHOT COPIES (Lane 241, B245, the founder's "let's do what Flock does"): every face the site
and the apps draw is a copy we hold, never a third party's image at request time.

`sync` (the Cloud Run Job `headshots`, weekly in season and daily in August) reads every provider
player with a headshot, fetches the image once, at most two fetches a second, converts it to webp at
the widths the web and the apps draw, and writes `headshots/<season>/<player_id>/<width>.webp` to the
images bucket `commish-images`, served publicly at `https://images.trycommish.app` and cached a year.
Its ledger is `research.headshot_copies` (`research.db.schema.images`): a copy that exists is not
fetched again unless its row is marked `refresh` or its source moved; a player with no image, or a
failed fetch, goes on the curation list. `curate` replaces one player's copy from a URL a person chose
and marks the row so the sync never overwrites it.

The URL the API and the nightly answer is `face_url` (`config.py`); the web builds the same addresses
(`web/src/lib/ui/headshot.ts`) and the API too (`api/internal/headshots`).
"""
