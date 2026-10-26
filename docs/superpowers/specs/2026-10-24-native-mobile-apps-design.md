# Native mobile apps: design

**Status:** design for the founder's review, 2026-10-24. The founder's review page: https://claude.ai/artifact/YbnneBFZvxt93LHGVJYtiF. Implementation plans follow per phase (§12) once approved.

## 1. Rulings this design rests on

All from the founder on 2026-10-24, in this order.

1. **Native on both platforms.** "Since code is cheap, I think we should build native apps to give the best experience possible." SwiftUI on iOS, Jetpack Compose on Android. Not React Native, not a WebView wrapper.
2. **The app is the in-season hub.** "I see the mobile app as being the in-season hub."
3. **Both stores.** "Let's do both."
4. **The draft experience ships in release one.** "We should go ahead and build the draft experience now, we might not come back to it next year. We already have the web as the design outline."

Standing rules that carry over unchanged: the Go API is the one contract; additive API fields that parse when absent; the Commish design direction (docs/design/mocks/2026-10-12-commish/) and the first principles (docs/design/2026-09-10-first-principles.md); the copy rules (no em-dashes, no semicolons, no betting words, no provider names, platforms named); one game-state function per screen; the clock injected; the loop per screen (mock, persona gate, build, review, ship).

## 2. Goals and non-goals

Goals: a member opens the app five times a day in season and once a night in August and never wants the website; the apps and the web show the same numbers and words from the same API on the same day; a screen change ships to the web, iOS and Android through the same loop.

Non-goals for release one: billing (the 2026 season is free); widgets, Live Activities and lock-screen scores (native extras after launch, §12); tablets as a distinct layout (the phone layout scales, the iPad build is allowed but not designed); a watch app.

## 3. Screen inventory

The web is the design outline. Each app screen maps to a web route and keeps that route's facts, words, verb and game-state function. Worker-drawn and prerendered alike, every screen below exists on the web today.

| Track | App screen | Web route | Notes |
| --- | --- | --- | --- |
| In season | Leagues | `/account` leagues list, `/league/new` | Attach a league on ESPN, Sleeper, Yahoo, MyFantasyLeague or FFPC; the existing attach preview and attach flow |
| In season | League home | `/league/[id]` | Scoreboard, standings, moves feed, lineup summary |
| In season | Start | `/league/[id]/start` | The lineup with the week's game state per line |
| In season | Matchup | `/league/[id]/matchup` | Sunday live, polled on the web's cadence |
| In season | Waivers | `/league/[id]/waivers` | The waiver table, the pickup strip, the claim |
| In season | Trades | `/league/[id]/trades` | The trade finder and the check |
| In season | Player sheet | the shelf on any row, `/players/[slug]` | A native sheet; the full page reachable from it |
| In season | Rankings | `/players` | The week's order |
| In season | Record | `/record` | What the record grades |
| In season | Account | `/account` | Devices, push switches, sign out |
| Draft | Board | `/board/[format]/[position]` | Tiers, format and position chips, the one verb |
| Draft | Player page | `/players/[slug]` | The hero, the number with its basis, the prose |
| Draft | ADP, compare, clubs, schedule | `/adp/[format]`, `/compare`, `/clubs/[abbr]`, `/schedule` | Reference screens |
| Draft | Sheet | `/sheet`, `/sheet/print` | Notes, tags, import, export (print becomes share) |
| Draft | Mock room | `/mock/new`, `/mock/[id]`, `/mock/[id]/report` | The room, the clock, the pick card, the report |
| Draft | Shared mock | `/mock/share/[code]` | Open by code |
| Draft | Lobby | `/lobby/[id]`, `/lobby/[id]/report` | Join, draft with people, the report |
| Draft | Companion | `/companion/new`, `/companion/[id]` | The second screen for a draft running on another platform |

The bottom bar is the web's phone bar for the season phase, exactly as `railFor` in `web/src/lib/ui/rail-order.ts` lists it (amended 2026-10-24 after Lane 173): in season League, Lineup, Matchup, Waivers, Trades (Waivers drops in the playoffs once the wire closes); before the draft Board, Players, Mock draft, Cheat sheet, Advisor (the League home is reached from the top bar's league switch, as on the web); on draft day Advisor, Board, Players, Cheat sheet, Mock draft. The apps switch the five by phase as the web does, and read the site's phase (`/season`) when no league is followed. The mark leads nothing on the phone.

## 4. Repository layout

```
apps/ios/                      Xcode project generated from project.yml (XcodeGen), SwiftPM packages
  Commish/                     the app target: scenes, tab bar, deep links, push registration
  Packages/CommishAPI/         generated client (Apple swift-openapi-generator) + a thin transport
  Packages/CommishDesign/      tokens (generated), type, the Mark, shared views (box table, chips, pills)
  Packages/CommishCore/        models, view models, clocks, game state readers, cache, room socket
  Packages/Features/<Screen>/  one package per screen family, views + view models + snapshots
apps/android/                  Gradle, Kotlin 2, Compose, version catalog
  app/                         the app module: navigation, bottom bar, deep links, push registration
  api/                         generated client (openapi-generator kotlin, kotlinx.serialization, Ktor)
  design/                      tokens (generated), type, the Mark, shared composables
  core/                        models, view models, clocks, game state readers, cache, room socket
  feature/<screen>/            one module per screen family, composables + view models + Paparazzi snapshots
shared/
  design/tokens.json           the one source of colours (both themes), type scale, spacing, radii
  fixtures/                    fixture leagues and boards as JSON, exported from web/src/fixtures by a script
  words/banned-words.json      moved from web/src/lib/format/banned-words.json; the web imports it from here
scripts/gen-tokens.ts          tokens.json -> web/src/lib/ui/tokens.generated.css, Swift enum, Kotlin object
```

Generation is a drift check, not a build step: generated files are committed, `make check-gen` (api/Makefile) regenerates Go, TypeScript, Swift and Kotlin clients plus the three token files and fails CI on any difference.

## 5. API contract changes

All additive, all parse when absent, all shipped before the first app screen that reads them. One API lane per group.

### 5.1 Game state on the wire

Today the web computes each line's game state at the page clock (`web/src/lib/league/box/kickoff.ts`). The API already holds `gameStateAt`. Every line the API serves (lineup, matchup, waivers, rankings, player week) gains `game_state` with the state (`not_started`, `kicked_off`, `final`, `bye`, `no_game`) and the word the screen shows, computed at the request's clock. The web may keep its function until it reads the field. One rule per screen remains: a screen reads the field, never recomputes.

### 5.2 Sign-in for an app

The existing device bearer path (`api/internal/auth/bearer.go`, `api/internal/devices`) built for the browser extension carries the apps too.

1. `GET /auth/login?client=ios|android&return_to=<app link>` opens WorkOS AuthKit in the system browser sheet (ASWebAuthenticationSession, Custom Tabs). The state cookie seals the client and the return.
2. `GET /auth/callback` signs the member in as today and, for an app client, mints a pairing code (the devices store's ten-minute code) and redirects to the app link `https://trycommish.app/app/signed-in?code=...` (universal link on iOS, app link on Android; the apple-app-site-association and assetlinks files are served by the web).
3. The app exchanges the code at `POST /devices/pair` for a device token with scopes `league:write` and `draft:write`, stored in the Keychain or EncryptedSharedPreferences.
4. `DELETE /devices/{id}` is sign-out; `/devices/me` lists devices in account.

Sign in with Apple: WorkOS AuthKit offers Apple as a provider. Apple's review requires it when Google sign-in is offered. The founder enables Apple in the WorkOS dashboard (a founder step, §11).

### 5.3 Push

- `PUT /devices/{id}/push` with `{platform: apns|fcm, token}`; `DELETE` removes it.
- `app.notifications` outbox: `id, account_id, device_id null, kind, title, body, data jsonb, created_at, send_after, sent_at, failed_at, attempts`. Producers insert rows; nothing sends inline.
- Delivery: a `notify` command in the API binary, run as the Cloud Run job `api-notify` on a one-minute Cloud Scheduler cadence in season (paused out of season like the warm pinger), draining rows by lease, APNs with a `.p8` token key, FCM v1 with a service account, exponential backoff, dead tokens deleted.
- Producers: the in-season job after the Thursday read passes (`research/inseason/season_week.py` calls an internal API route with the job's identity), the status capture for a member's starters, the league sync when claims resolve.
- Preferences on the account: quiet hours (default 23:00 to 08:00 local), one switch per kind. `GET/PATCH /me` carries them.

### 5.4 The room

The room service (`api/cmd/room`, spec docs/superpowers/specs/2026-09-19-live-room-service-design.md) keeps its protocol. The apps port `web/src/lib/room/lobby-socket.ts`: connect with session affinity, replay the action log, reconnect with the last seen action, never lose a pick. The protocol is documented from the TypeScript client into `docs/superpowers/specs/` as part of the foundation so three clients read one description.

## 6. App architecture

### 6.1 iOS

Swift 6 with strict concurrency, iOS 17 minimum, the Observation framework, no third-party UI. Layers: `CommishAPI` (generated, async, one `Transport` that adds the bearer token and the request id), `CommishCore` (plain models mapped from the generated types, view models as `@Observable`, a `Clock` protocol injected everywhere, the room socket, a file cache of the last answer per screen keyed by its stamp), `CommishDesign` (tokens as a generated enum, a `Theme` environment honoring system appearance, the Mark, the box table primitives), one feature package per screen family. Navigation: a `TabView` with five tabs, `NavigationStack` per tab, the player sheet as a `.sheet` with detents. Deep links: universal links for `/players/`, `/league/`, `/mock/share/`, the sign-in return.

### 6.2 Android

Kotlin 2, Compose with Material 3 themed from the tokens, minSdk 26, coroutines and Flow, no DI framework (a hand-built graph in the app module, constructor injection everywhere). Modules mirror the iOS packages. Navigation: Compose Navigation with five bottom destinations and a back stack per destination; the player sheet as a `ModalBottomSheet`. Deep links through app links for the same paths. Snapshots with Paparazzi, UI tests with Compose test rules on an emulator.

### 6.3 Shared rules

Every time-dependent function takes the clock. View models hold no platform types. The banned-words test runs over `Localizable.xcstrings` and `strings.xml`. No screen computes game state; it reads `game_state`. Numbers keep their basis in the same view. One verb per screen.

## 7. Design

The Commish direction in each platform's idiom: our tokens and faces, native navigation, system dark mode honored, the whistle as the icon from the same module as the web's mark. Screens are box scores: columns of numbers, the player biggest, the basis once in a footer. Each screen's mock is its snapshot test rendered in both themes at two sizes, and that render is what the persona panel (veteran, casual, commissioner, first-timer) reads before a build is accepted. iOS leads each screen by one step and sets its design; Android follows the approved render.

## 8. Offline and live

The last answer per screen is cached on device with its stamp and shown at once on open, dated, then refreshed. The board and the lineup read with no signal. Sunday's matchup polls the scoreboard on the web's cadence and stops when the tab is hidden. The room socket reconnects with the action log.

## 9. Testing and gates

- View models against `shared/fixtures` with injected clocks, on both platforms.
- Snapshot tests per screen, both themes, two sizes (iOS: swift-snapshot-testing; Android: Paparazzi).
- UI tests on five flows: sign in, attach a league, set a lineup, claim a waiver, open a player; plus the mock room's first pick.
- Contract tests: the generated client against the OpenAPI examples through a local stub.
- Lane gates before a report: iOS `xcodebuild build test` on a simulator, SwiftLint, SwiftFormat check; Android `./gradlew lint testDebugUnitTest verifyPaparazziDebug connectedDebugAndroidTest`; `make check-gen` for drift; the banned-words test.

## 10. Build and ship

Two workflows: `.github/workflows/ios.yml` (macOS runner, Xcode pinned, SwiftPM cache, build, test, Fastlane `pilot` upload to TestFlight on main) and `android.yml` (Ubuntu, Gradle cache, build, test, the signed bundle to the internal track on main through the Play Developer API, `apps/android/scripts/play-upload.ts`). Secrets: an App Store Connect API key, the signing certificate and profile (Fastlane match against a private repo, or manual signing with the key), the Play service account `commish-play` reached by GitHub federation (`vars.PLAY_SA`; the organization forbids service-account keys, so there is no JSON key), the APNs `.p8`, the FCM service account. The store release is a lane: listings, screenshots from the snapshot suite, privacy labels and data-safety form, review notes with a test account, submit, watch review.

## 11. Founder items and spend

| Item | Cost | Why |
| --- | --- | --- |
| Apple Developer Program, Commish LLC | 99 USD per year | TestFlight and the App Store |
| Google Play Console | 25 USD once | The internal track and the Play Store |
| Firebase project | free tier | FCM for Android push |
| macOS CI minutes on GitHub | roughly 50 to 150 USD per month at launch cadence | iOS builds and simulators |

Founder steps once the accounts exist: enable Apple as a sign-in provider in WorkOS; share the App Store Connect API key, the Play service account and the APNs key in chat (stored at once, never echoed); approve the store listings.

## 12. Order of work

Each phase is its own implementation plan, written with the planning skill after this spec is approved.

1. **Foundation.** `shared/` with tokens, fixtures and words; the generators and the drift check; `apps/ios` and `apps/android` skeletons with the design packages, the API clients, sign-in (§5.2 on the API too), the room socket client, the cache, the five-tab shell, one screen (League home) end to end, and both CI workflows uploading to TestFlight and the internal track.
2. **Screens in the loop, two tracks in parallel.** In season: start, matchup, waivers, trades, player sheet, rankings, record, account. Draft: board, player page, sheet, ADP and compare, mock room, lobby, companion. The API's game-state fields (§5.1) land first. The in-season track ships first because it is October.
3. **Push.** §5.3 end to end, with the three producers.
4. **Store release.** Listings, privacy, review, launch; the draft screens follow in updates as they pass.
5. **Native extras.** Widgets and lock-screen scores on Sunday, after launch.

## 13. Risks and how the design meets them

- **Three-way drift.** One contract, generated clients, one token source, one fixture set, one word test, a drift check in CI, and the API serving game state. Review on every lane checks the deploy pair both ways.
- **Store review latency in season.** Everything weekly comes from the API. A store release is for new screens only.
- **Apple review.** Native UI, push, offline, Sign in with Apple beside Google, a test account in the review notes.
- **The room over a phone network.** Reconnect with the action log; the server already outlives an instance.
- **macOS minutes.** Cache SwiftPM and derived data, build on main and on lane branches only, nightly full UI runs.
- **A lane's machine.** Each lane owns its simulator and emulator by name, its own ports, and never production.
