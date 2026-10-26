# The recorded mock draft

Recorded by web/scripts/record-mock-room.ts against a local API (Lane 213), not generated: run it again
to refresh it. Two solo mocks on seed 213, twelve teams, PPR, the standard roster, every answer kept
whole as the API sent it (the envelope with `ok`, `data`, `error`). The apps' mock room reads it as the
room's exchange (CommishAPI's MockFixture) and shared/scripts/mock-parity.ts writes
shared/fixtures/parity/mock.json from the web's own functions over it.

Each board is kept to its first 300 players and every player an answer names (picks, the queue, a
card's call, shortlist and chances, a report's starters), in its order: the whole board (1,468 players)
made each file 400 KB. The pool's counts are the trimmed board's.

| File | Route | What it holds |
| --- | --- | --- |
| `create.json` | `POST /mocks` | slot 5, the first turn at 1.05 with the board and the card |
| `card-first.json`, `card-5.json` | `GET /mocks/{id}/card` | our call at 1.05 |
| `pick-1.json` to `pick-4.json` | `POST /mocks/{id}/picks` | our call drafted by hand at 1.05, 2.08, 3.05, 4.08 |
| `round5.json` | `GET /mocks/{id}` | the room at 5.05 with the board and the card |
| `queue.json` | `PUT /mocks/{id}/queue` | three players queued |
| `shared-round5.json` | `GET /shared/mocks/{code}` | the draft at 5.05 through its link |
| `undo.json` | `POST /mocks/{id}/undo` | 4.08 taken back |
| `pick-again.json` | `POST /mocks/{id}/picks` | 4.08 drafted again |
| `autopick.json` | `POST /mocks/{id}/autopick?to_round=8` | Pick for me through round 8 |
| `finish.json` | `POST /mocks/{id}/finish` | the draft finished |
| `report.json` | `GET /mocks/{id}/report` | the report, 1st of 12 |
| `shared-complete.json`, `shared-report.json` | `GET /shared/mocks/{code}`, `/report` | the finished draft through its link |
| `report-down.json` | `GET /mocks/{id}/report` | slot 12, a kicker, a defense and a quarterback by hand then Finish: 12th of 12 |
