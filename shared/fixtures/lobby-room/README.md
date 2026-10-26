# The recorded lobby

Recorded by `api/tools/lobbyrecord` against a local API and room service (Lane 229), not generated:
run it again to refresh it. Three drafters (`you`, `jpk88`, `mara`) take seats in a 12_ppr lobby; it
starts 90 seconds after the first join with bots in the nine open seats (not at solo pace: three people)
and each drafter drafts our call by hand on its own clock as the frames bring its turn, to the end of
the draft. Every answer is kept whole as the API sent it (the envelope with `ok`, `data`, `error`);
the room's board is kept to its first 300 players and every player the recording names, in its order.
The apps' lobby reads it as the room's exchange (CommishAPI's LobbyFixture) and
shared/scripts/lobby-parity.ts writes shared/fixtures/parity/lobby.json from the web's own functions
over it.

| File | Route | What it holds |
| --- | --- | --- |
| `join.json` | `POST /lobbies/join` | `you`'s seat, 12, and the room's socket |
| `lobbies.json` | `GET /lobbies` | the three formats, 12_ppr filling with three in |
| `room-filling.json` | `GET /lobbies/{id}` | the room while it fills: settings, seats, board, socket |
| `room-complete.json` | `GET /lobbies/{id}` | the room once drafted |
| `exchange.json` | `/rooms/{id}/ws` | every frame `you` sent (`client`) and received (`server`), in order: the hello, the welcome with the three joins, the start, the queue, every pick to `ROOM_COMPLETE` |
| `card-12.json`, `card-13.json`, `card-36.json`, `card-37.json` | `GET /lobbies/{id}/card` | our call on `you`'s turns at 1.12, 2.01, 3.12 and 4.01 |
| `report-you.json`, `report-jpk88.json`, `report-mara.json` | `GET /lobbies/{id}/report` | each seat's report: 1st, 5th and 6th of 12 |
