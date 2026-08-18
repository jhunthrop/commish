# Commish — League Chat

Read this with `docs/conventions.md`, `docs/league.md` and `docs/draft-room.md` before touching
anything under `src/chat/`, `src/chat-service/` or `src/chat-room/`.

## What it is, and why it's league-scoped

One conversation per league — not per draft, not per matchup. The strategy doc's thesis (§1.2,
§4) is that Sleeper proved the reason people actually play fantasy football is social: the trash
talk, not the waiver wire, is what keeps a league alive year over year, and no real-money
competitor has built that in. A draft-scoped chat would strand the best trash talk — the stuff
that happens the moment a rival reaches for a player everyone else wanted — in a room that closes
the second the draft ends. League chat is mounted by the league home page (where it lives all
season) and by the draft room (where it also lives for the two hours a league is actually
watching each other), but it is the same conversation in both places, backed by the same table.

## The three layers

Same shape as the draft and the league: one pure layer, one Postgres layer, one browser layer
that never imports either directly.

| Path | Rule |
|---|---|
| `src/chat/` | Pure fold + wire contract + `CHAT_CONFIG`. NO I/O, no `Date.now()`. 100% coverage enforced (`vitest.config.mts`). |
| `src/chat-service/` | The only part that talks to Postgres: `postMessage`, paginated `listMessages`, `toggleReaction` — each persists first, then publishes on the league's Redis stream. |
| `src/chat-room/` | The browser half: the `useLeagueChat` hook, the `useChatRoomDeps` seam (injected `fetchJson`/`openEventSource`, the same pattern `DraftRoomDepsProvider` uses), and every chat component (`LeagueChat`, `MessageList`, `ChatComposer`, `ReactionBar`). Behind the **same** ESLint client-boundary rule as `src/draft-room/**` and `src/league-room/**` — it may not value-import `@/db*` or `@/lib/realtime*`. It DOES value-import `@/chat` directly (`mergeMessages`, `applyReaction`, `CHAT_CONFIG`): unlike `@/draft-engine`/`@/league`, that module is pure and browser-safe, not server-only. `@/chat-service` itself is never imported at all — reached only over the wire. |

## The tables

`chat_messages` — `id` is a `bigserial`, and that same id **is the page cursor**: because a
bigserial is monotonic, a numeric comparison on `id` is already chronological order, so there is
no separate `createdAt` tie to break when paging. Indexed on `(league_id, id)` — every read this
product makes is scoped to one league and ordered by that id.

`chat_reactions` — primary key `(message_id, user_id, emoji)`. The pair **is** the identity: there
is no `count` column anywhere, and nothing to drift, because every count in the product is
derived by counting rows with that emoji. A reaction is a toggle resolved by which write a given
call actually made: `toggleReaction` runs `INSERT ... ON CONFLICT DO NOTHING RETURNING` first —
one atomic statement, so under a concurrent double-tap the unique key guarantees at most one
caller's insert ever returns a row, and that caller alone reports "added". Every other caller
falls through to a `DELETE ... RETURNING`, judged the same way: by its own returned rows, never by
a prior read. If two callers both reach the DELETE for the same row, Postgres serializes them and
only the first actually removes anything — the second reports the true resulting state
("removed", since the row is in fact gone) but skips the publish, because publishing would be a
phantom duplicate of a transition this call never made. Publishing is injectable via a
`PublishErrorSink` (mirroring `DraftStoreDeps.onPublishError`'s shape) so a test can assert the
swallow without spying on the global console; it defaults to `console.error`.

## Real-time

`chat.message` and `chat.reaction` ride the **existing** `league:<id>:events` stream — no new
event type, no second stream. Both are enumerated in `src/lib/realtime/events.ts` alongside the
draft taxonomy.

Payload contracts (`src/chat/contract.ts`):

```ts
/** `chat.message` payload. */
interface ChatMessagePayload {
  readonly message: ChatMessageView; // id, authorUserId, authorName, authorAvatarUrl, body, createdAt, reactions
}

/** `chat.reaction` payload. Carries the actor so the client fold is idempotent under replay. */
interface ChatReactionPayload {
  readonly messageId: string;
  readonly emoji: string;
  readonly userId: string;
  readonly action: "added" | "removed";
}
```

**Why the reaction frame carries `userId`.** The client fold recomputes each message's reaction
counts from a *set* of `(emoji, userId)` pairs, not a running counter. That makes a
`Last-Event-ID` replay of the same frame a no-op instead of a double count: applying "user X added
🔥" twice still leaves exactly one `(🔥, X)` pair. The tradeoff is deliberate — it puts an opaque
WorkOS user id on a membership-gated stream, and nothing else about that user ever rides the wire.

The chat SSE proof (`src/chat-service/chat-realtime.test.ts`) runs through the **real** route
handlers (`GET`/`POST /api/leagues/[leagueId]/chat`, `POST .../reactions`) and the real
`getPublisher()` singleton — not a mocked publish function — subscribing with the same
`subscribe()` helper a browser's `EventSource` is the client-side counterpart of, against the
real test Redis. It is the server half of the two-SSE-client exit criterion.

## Pagination

Every read is `CHAT_CONFIG.pageSize` (50) messages. `GET .../chat?before=<messageId>` pages
backwards from that id, newest page first without a cursor, older pages by naming the oldest id
already held. `listMessages` fetches `pageSize + 1` rows so `hasMore` costs no second round trip —
if the extra row came back, there's more behind it. **There is no unpaginated read anywhere in
this module.** Chat is the one table in this product that grows without bound for the life of a
league — every other table this codebase queries is either bounded by roster/schedule size or
already paginated by week — so an "all messages" query is a slow query waiting for its first busy
league, not a convenience worth keeping around for the quiet ones.

## The client fold (`src/chat/messages.ts`)

`mergeMessages(held, incoming)` **unions** each message's reactions rather than overwriting them.
A redelivered `chat.message` frame (from a `Last-Event-ID` replay, or the server's own echo after
`POST`) was built at the moment the message was created — before anybody had reacted to it — so
taking that frame's empty reaction list literally would silently erase reactions already folded in
from later `chat.reaction` frames. Everything here is set-shaped (deduped on `emoji:userId`), so a
replay is a no-op instead of a correction. Held messages are also capped at
`CHAT_CONFIG.maxHeldMessages` (500), keeping the newest — but only for **live** frames landing
through `mergeMessages`. `loadEarlier`'s backward-pagination prepend deliberately does **not**
route through `mergeMessages`: a full buffer plus an older page fetched via `?before=` would have
that same trim immediately discard the very page pagination just fetched. The config comment on
`maxHeldMessages` documents this: scrolling into history may hold more than the cap, by design.

`applyReaction(held, payload)` is remove-then-maybe-add: it always filters out any existing
`(emoji, userId)` entry for that message first, then re-adds it only if `payload.action !==
"removed"`. That makes it idempotent in both directions — a redelivered "added" produces exactly
one entry, and a "removed" for something already gone is a no-op rather than an error.

## Where it mounts

`LeagueHome` (`src/league-room/**`) renders `LeagueChat` as an ordinary page section — the league
home page is a document, and chat is one more thing on it.

`DraftRoom` (`src/draft-room/components/draft-room.tsx`) is the one place that knows both the
league id and builds a fully-loaded room in its own test, so it builds `<LeagueChat
leagueId={room.view.leagueId} />` once and passes it down as `aside`, exactly the way
`AuctionRoom` passes `bidConsole` and `poolFooter` down to `RoomShell`: `DraftRoom` → `SnakeRoom` /
`AuctionRoom` → `RoomShell` → `RoomLayout`'s optional right-hand `aside` band. That is also why
only `DraftRoom`'s own test needs to wrap the tree in `ChatRoomDepsProvider` — every component
below it just renders whatever node it was handed.

**The loading state uses `<Card as="section" aria-label="League chat">`** wrapping a `Skeleton`,
so the surface reads as one labeled region in both its loading and ready states. The log region
itself — the scrolling list of messages — is `role="log"` `aria-live="polite"` labeled
**"Messages"** (`aria-label="Messages"` on `MessageList`'s inner `<div>`), distinct from the
`aria-label="League chat"` on the outer `Card`: an arriving message announces itself without
moving focus out of whatever the manager is typing in the composer.

## Routes

Every chat route goes through the same `withLeagueMemberActor` gate `docs/league.md` documents —
a manager with a team in the league, or the commissioner; a signed-in stranger gets 403.

| Route | Who | Notes |
|---|---|---|
| `GET /api/leagues/[leagueId]/chat` | a manager with a team in the league, or the commissioner | `?before=<messageId>`. One page of `CHAT_CONFIG.pageSize` messages, oldest first, with `hasMore`. There is no unpaginated read. |
| `POST /api/leagues/[leagueId]/chat` | same | Body: `{ body }`. The author is the session's user (`actor.userId`); no body field can change it. |
| `POST /api/leagues/[leagueId]/chat/[messageId]/reactions` | same | Body: `{ emoji }` from `CHAT_CONFIG.reactions`. One verb toggles both directions. |

## Known follow-ups

- **Moderation / reporting.** Nothing in this phase lets a commissioner or a manager flag or hide
  a message. The reaction set is deliberately closed and small specifically because an open emoji
  picker would *also* be a moderation surface this phase has no answer for — see the comment on
  `CHAT_CONFIG`.
- **Per-message deletion.** There is no delete path, by anyone, including the author. A chat
  history that can be edited after the fact is a harder integrity story than this phase needs to
  solve yet.
- **Unread counts.** `LeagueHome` and the draft room both render the conversation live, but
  nothing tracks "how many messages since you last looked" for a manager who isn't currently
  looking — that needs a per-user read-cursor this phase doesn't have a table for.
- **Typing indicators.** Would need its own ephemeral (non-persisted) event on the stream, and
  this phase's real-time budget went to the two frames above instead.
- **KNOWN LIMITATION — two `EventSource`s per draft-room viewer.** `DraftRoom` opens its own
  `EventSource` on `/api/leagues/[leagueId]/events` via `useDraftRoom`, and the `LeagueChat` it
  mounts as `aside` opens a **second, independent** `EventSource` on the same URL via
  `useLeagueChat`. Both work correctly — the server has no `XREADGROUP` fan-out problem, every
  connection gets every event — but a draft-room viewer holds two live SSE connections to the
  same stream instead of one, each doing its own `Last-Event-ID` bookkeeping and its own resync on
  `open`. Left for the final review to consolidate into one shared subscription.
