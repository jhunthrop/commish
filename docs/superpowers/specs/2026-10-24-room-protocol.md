# The room protocol: the lobby's WebSocket, for three clients

Date: 2026-10-24. Lane 171 (mobile foundation, Task A). Written from the web's client,
`web/src/lib/room/lobby-socket.ts`, and the room service, `api/cmd/room` with its runtime in
`api/internal/rooms` (socket.go, limits.go) and the room's log in `api/internal/lobby`. The frames'
shapes are the contract's, `api/openapi.yaml` (`RoomHello`, `RoomWelcome`, `RoomUpdate`, `RoomError`,
`RoomCommand`, `RoomAction`, `RoomPick`), so the iOS and Android clients generate them as the web
does. This document says how they move. Where it and the code disagree, the code wins and this
document is fixed.

The room's state is its log, `app.room_actions`: every row has a `seq`, one more than the row before
it. A client keeps the last `seq` it applied and nothing else it cannot rebuild, so a socket that
drops reconnects by the room id and that `seq` and loses nothing (socket.go:5-6).

## 1. Where the socket is

`GET /lobbies/{id}` (and `POST /lobbies/join`) answers the room with `socket_url`, the room service's
WebSocket for that room: `<ROOM_BASE_URL>/rooms/{id}/ws` (api/internal/lobby/handler.go:72). A client
opens exactly that URL; it never builds one.

```json
{ "room_id": "0b8d3f0e-6f43-4a4e-9f0f-3c1d2a7e5b10", "seat": 4, "socket_url": "wss://room.example/rooms/0b8d3f0e-6f43-4a4e-9f0f-3c1d2a7e5b10/ws" }
```

The upgrade is `GET /rooms/{id}/ws` with access `SignedIn`, at most 30 a minute per caller
(socket.go:83). The browser is signed in by its session cookie. An app is signed in by its device
token in `Authorization: Bearer <token>` once Task B of the mobile foundation plan
(docs/superpowers/plans/2026-10-24-mobile-foundation.md) gives app tokens the session scope; a
native client sends no `Origin`, and the WebSocket library (`github.com/coder/websocket` v1.8.12)
checks `OriginPatterns` only on a request that carries one (socket.go:97).

### Refused before the upgrade

The service answers these as plain HTTP with the API's error envelope, before any frame:

| Status | Code | When |
| --- | --- | --- |
| 401 | `unauthorized` | not signed in |
| 403 | `forbidden` | the account holds no seat in the room, now or before it left (socket.go:140-143, "You do not have a seat in this room") |
| 404 | `not_found` | no such room (socket.go:132-134) |
| 429 | `rate_limited` | more than 30 upgrades a minute |

A browser never sees an upgrade's status, so the web asks `GET /lobbies/{id}` when a socket closes
before its welcome (the `probe`, lobby-socket.ts:32-37 and :82-91): a 401, 403 or 404 there
(`isFinalRefusal`, web/src/lib/room/api.ts:39-41) stops the retries for good with that reason; any
other answer retries. A native client may read the upgrade's status directly and apply the same
rule: 401, 403 and 404 are final, anything else retries.

## 2. Session affinity

The room service runs on Cloud Run with `--session-affinity` (.github/workflows/api.yml:186), its CPU
never throttled and a request timeout of an hour, so a socket stays on one instance and a reconnect
from the same client tends to land on it again. Nothing in the protocol depends on landing on the
same instance: every instance reads the same log, and the `hello` names where the client left off.
A client keeps whatever affinity cookie the front end sets on the upgrade's response and sends it
back on its reconnects (a browser does so by itself; an app's cookie storage must too).

## 3. The hello

The first frame is the client's, sent as soon as the socket opens (lobby-socket.ts:60-62): the last
`seq` it applied, 0 for none.

```json
{ "type": "hello", "last_seq": 0 }
```

The service waits 10 seconds for it (`helloTimeout`, socket.go:35). Anything else first, or a
negative `last_seq`, is answered with an error frame and the socket is closed with 1008
(socket.go:199-202):

```json
{ "type": "error", "code": "invalid", "message": "The first message must be a hello with the last seq you applied" }
```

Close: code `1008`, reason `hello expected`.

## 4. The welcome

The service answers the hello with every row after `last_seq`, the room's latest `seq` and its own
clock (socket.go:222-232). On connecting, a drafter who had left is given the seat back
(`SEAT_RETURNED`) and marked present.

```json
{
  "type": "welcome",
  "room_id": "0b8d3f0e-6f43-4a4e-9f0f-3c1d2a7e5b10",
  "seq": 3,
  "now": "2026-08-20T01:02:03.456Z",
  "actions": [
    { "seq": 1, "kind": "SEAT_JOINED", "seat": 1, "payload": { "handle": "jpk88" }, "at": "2026-08-20T00:58:00Z" },
    { "seq": 2, "kind": "SEAT_JOINED", "seat": 4, "payload": { "handle": "you" }, "at": "2026-08-20T00:59:10Z" },
    { "seq": 3, "kind": "ROOM_STARTED", "seat": null, "payload": { "bots": [2, 3, 5, 6, 7, 8, 9, 10, 11, 12], "solo_pace": false }, "at": "2026-08-20T01:00:00Z" }
  ]
}
```

- `seq` is the last row sent, `last_seq` itself when nothing is new.
- `now` is the server's clock. The client's clock offset is `now` less its own clock at the moment it
  reads the welcome (lobby-socket.ts:109), and every countdown (a pick's `deadline`) is drawn on the
  server's clock through it. A client takes a fresh offset from every welcome.
- A welcome resets the retry ladder (lobby-socket.ts:107).

## 5. Updates

Every write to the room's log goes out to every socket on the room in `seq` order, as an update with
the rows after the last one that socket was sent (`catchUp`, socket.go:288-296). A notification lost
while the hub reconnected is caught up at the latest one ping later (socket.go:275-279).

```json
{
  "type": "update",
  "seq": 5,
  "actions": [
    { "seq": 4, "kind": "MAKE_PICK", "seat": 1, "payload": {
        "action": { "type": "MAKE_PICK", "timestamp": "2026-08-20T01:00:21Z", "teamId": "1", "playerId": "9509" },
        "pick": { "pick": 1, "round": 1, "seat": 1, "player_id": "9509", "auto": false, "by": "drafter" },
        "deadline": "2026-08-20T01:00:51Z" },
      "at": "2026-08-20T01:00:21Z" },
    { "seq": 5, "kind": "SET_QUEUE", "seat": 3, "payload": {}, "at": "2026-08-20T01:00:22Z" }
  ]
}
```

The client applies rows strictly in `seq` order and records the highest `seq` it applied
(lobby-socket.ts:111-115). What a row carries (openapi.yaml `RoomAction`, socket.go:159-183):

- `SEAT_JOINED` (payload `handle`), `SEAT_LEFT` (payload `freed` when a filling room gave the seat
  up, otherwise its stand-in drafts), `SEAT_RETURNED`, `ROOM_STARTED` (payload `bots`, the seats bots
  took, and `solo_pace`), `ROOM_COMPLETE`, `ROOM_ABANDONED` (payload `reason`: `nobody_here` or
  `everyone_left`).
- An engine row (`START_DRAFT`, `SET_QUEUE`, `MAKE_PICK`, `TIMER_EXPIRE`) carries the engine's action
  as `action`; a pick also carries `pick` (a `RoomPick` with `by`: `drafter`, `queue`, `clock` or
  `bot`) and `deadline`, when the next turn's clock runs out.
- A seat reads only its own queue: another seat's `SET_QUEUE` arrives with its `seq` and `kind` and
  an empty payload, so the client's `seq` stays whole. `START_DRAFT` arrives without its pool (the
  page holds the board), and no row carries the odds a pick recorded.

## 6. Commands

The client sends a command as a frame of its own once the socket is open, and only then: a client
whose socket is not open does not queue it (lobby-socket.ts:118-122). Commands are
`RoomCommand`s:

```json
{ "type": "pick", "player_id": "9509", "pick": 1 }
```

```json
{ "type": "queue", "player_ids": ["9509", "8150", "7547"] }
```

```json
{ "type": "leave" }
```

- `pick` names the player and the overall pick the drafter saw on the clock, so a pick made on a
  stale screen is refused, not applied to the next turn.
- `queue` is the whole queue, best first, at most 50; an empty list clears it.
- `leave` gives the seat up.

A command that works produces log rows, which come back to every socket, this one included, as an
update. The command itself has no acknowledgement frame: the client sees its pick land when the
`MAKE_PICK` row arrives.

### Refused

A refused command is answered with an error frame and the socket stays open
(socket.go:312-349). The message is the room's own words, shown to the drafter as they are
(`onrefused`, lobby-socket.ts:102-104):

```json
{ "type": "error", "code": "conflict", "message": "You are not on the clock." }
```

| Code | When | Message |
| --- | --- | --- |
| `conflict` | the engine refused it (not on the clock, the player taken, a stale pick) | the refusal's reason, for example "You are not on the clock." (api/internal/lobby/ops.go:24) |
| `conflict` | a pick missing its player or its pick | "A pick names the player and the pick on the clock." |
| `conflict` | a type the room does not know | "That is not a command the room knows." |
| `conflict` | the account has no seat | "You do not have a seat in this room" |
| `rate_limited` | over the seat's command budget | "Slow down: the room takes a few commands a second." |
| `internal` | anything else | "Something went wrong on our side" |

The command budget is per seat, shared by every socket the seat holds on the instance, one bucket
per type (api/internal/rooms/limits.go:13-30): `queue` 5 a second with a burst of 10, `pick` 2 with
3, `leave` 1 with 2, any other 1 with 2. A socket that has had 30 commands dropped
(`abusiveDropped`) is closed with 1008, reason `too many commands` (socket.go:248-251).

## 7. Closing, and the 1008 close

The service closes a socket with 1008 (policy violation) only when it refuses it on purpose, and it
sends an error frame saying why first:

| Reason on the close | Error frame first | Where |
| --- | --- | --- |
| `hello expected` | `invalid`: "The first message must be a hello with the last seq you applied" | socket.go:199-202 |
| `seat over its socket budget` | `rate_limited`: "This seat already has three tabs open on the room. Close one and reload." | socket.go:108-112, limits.go:47 |
| `seat over its socket budget` | `rate_limited`: "This seat is reconnecting too fast. Wait a few seconds and reload." | socket.go:108-112, limits.go:48 |
| `too many commands` | none for the closing command itself, only the `rate_limited` refusals before it | socket.go:248-251 |

The socket budget is per seat on the instance (limits.go:32-43): at most 3 sockets open at once, a
new one at most 12 a minute after a burst of 6; a seat with no socket for 10 minutes is forgotten.

A client that is closed with 1008 stops for good and shows the error frame's message
(lobby-socket.ts:19-20 and :70-76): a retry would only be refused again.

A client leaving the room closes with 1000, reason `left the page` (lobby-socket.ts:124-128), and
stops retrying. When a drafter's last socket on an instance closes, the seat goes to its stand-in at
once (`Disconnect`, socket.go:207-215); the drafter's next socket takes it back.

## 8. Keeping the socket alive

The service pings every 10 seconds and gives a pong 5 (socket.go:36-37); a peer that misses it is
dropped, well inside a 30 second pick clock, so its seat drafts by its stand-in before the clock
would have run out. Each ping also marks the seat present. A client answers pings as the WebSocket
protocol says (every platform's WebSocket does so by itself) and sends nothing of its own to keep
the socket open. Frames are JSON text, at most 8 KiB from the client (`maxMessage`, socket.go:40).

## 9. Reconnecting: the retry ladder

Any close other than 1008 and the client's own is retried (lobby-socket.ts:68-99):

- The waits are `[250, 500, 1000, 2000, 5000]` milliseconds (`RETRY_MS`, lobby-socket.ts:17), one
  step per attempt, staying at 5000 after the last. A welcome resets it to the first step.
- A socket that closed after its welcome retries on the ladder, its first wait 250 ms.
- A socket that closed before its welcome asks why first (section 1's probe): final, it stops; else
  it retries on the ladder.
- Every retry opens the same `socket_url` and sends a hello with the last `seq` applied, so the
  welcome carries exactly the rows missed, never one twice and never one lost.

The client's state across a reconnect is the `seq` and the rows it applied; its status runs
`connecting` (the first attempt), `open` (a welcome), `reconnecting` (after a drop), `closed` (stopped
for good) (lobby-socket.ts:22).

## 10. A whole exchange

```text
client  GET /lobbies/0b8d3f0e-...                      -> 200 { ..., "socket_url": "wss://.../rooms/0b8d3f0e-.../ws" }
client  GET wss://.../rooms/0b8d3f0e-.../ws            -> 101 Switching Protocols
client  { "type": "hello", "last_seq": 0 }
server  { "type": "welcome", "room_id": "0b8d3f0e-...", "seq": 3, "now": "...", "actions": [ ...3 rows ] }
client  { "type": "queue", "player_ids": ["9509", "8150"] }
server  { "type": "update", "seq": 4, "actions": [ { "seq": 4, "kind": "SET_QUEUE", "seat": 4, "payload": { "action": { "type": "SET_QUEUE", "timestamp": "...", "teamId": "4", "playerIds": ["9509", "8150"] } }, "at": "..." } ] }
client  { "type": "pick", "player_id": "9509", "pick": 3 }
server  { "type": "error", "code": "conflict", "message": "You are not on the clock." }
        ... the network drops ...
client  GET wss://.../rooms/0b8d3f0e-.../ws            (after 250 ms)
client  { "type": "hello", "last_seq": 4 }
server  { "type": "welcome", "room_id": "0b8d3f0e-...", "seq": 6, "now": "...", "actions": [ rows 5 and 6 ] }
```
