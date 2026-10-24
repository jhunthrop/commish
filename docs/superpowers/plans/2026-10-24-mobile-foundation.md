# Mobile Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this repository tasks run as lanes: one worktree per task, a brief, a report, a review, the coordinator merges.

**Goal:** the shared design and word sources, the API's app sign-in, and an iOS and an Android app that each sign in, show the League home from the live API, pass their gates, and upload to TestFlight and Play's internal track from CI.

**Architecture:** the Go API stays the one contract; the apps are thin SwiftUI and Compose clients over generated OpenAPI clients; colours, type scale, spacing and the web's word tables are generated from one source into CSS, Swift and Kotlin with a drift check; sign-in rides the existing device bearer-token path with a session scope so one token opens every signed-in route.

**Tech Stack:** Go 1.2x API (oapi-codegen), SvelteKit web, Swift 6 / SwiftUI / SwiftPM (iOS 17+, XcodeGen), Kotlin 2 / Jetpack Compose / Gradle (minSdk 26, JDK 17), Apple swift-openapi-generator, openapi-generator (kotlin, kotlinx-serialization, Ktor), swift-snapshot-testing, Paparazzi, Fastlane, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-24-native-mobile-apps-design.md`

## Global Constraints

- Additive API fields only; every client parses an answer missing a new field; the previous web keeps working for one deploy.
- No em-dashes, no semicolons in any member-facing string; no betting words (`shared/words/banned-words.json` after Task A); platforms named (ESPN, Sleeper, Yahoo, MyFantasyLeague, FFPC), never "host"; the projection provider never named.
- Every time-dependent function takes the clock; tests pass a fixed one. No screen computes game state once the API serves it; until then the app ports the web's reader for that screen and names the port in its report.
- Lanes share one machine: own ports, own 5433 databases named `lane<NN>_*`, own simulator and emulator names, stop only your own pids, production and port 5440 never, never `git add .superpowers/`.
- Commit trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; conventional commits; a commit command never contains the word the `block-no-verify` hook looks for.
- Generated files are committed; `make -C api check-gen` regenerates everything and fails on a difference.
- Secrets never in the repo or in a report. Store credentials arrive from the founder in chat and go to GitHub secrets.

## Review Focus

1. A device token minted for an app must open every signed-in read (boards, leagues, rankings), and a token minted for the browser extension must not gain that: the session scope is explicit, and a test tries an extension token on `/leagues/attached` and expects 401 (Task B).
2. An app opened with no network shows the last League home with its stamp, never a blank screen or a crash: a view-model test loads from the cache with the transport failing (Tasks C and D).
3. A generated token file edited by hand must fail CI: the drift test regenerates into a temp dir and compares byte for byte (Task A).
4. The web's rendering must not change when tokens move to the generated file: a test asserts every colour the old `tokens.css` carried equals the generated value, both themes (Task A).
5. The sign-in callback must refuse a `return_to` that is not the app link: a test passes `return_to=https://evil.example/` with `client=ios` and expects the API's own 400 (Task B).

---

### Task A: the shared sources and the generators (Lane 171)

**Files:**
- Create: `shared/design/tokens.json`, `shared/scripts/gen-tokens.ts`, `shared/scripts/gen-words.ts`, `shared/scripts/export-fixtures.ts`, `shared/scripts/check-gen.ts`, `shared/words/league-home.json`, `shared/fixtures/README.md`, `shared/fixtures/mock-2026-ppr.json`, `shared/fixtures/inseason/*.json`, `docs/superpowers/specs/2026-10-24-room-protocol.md`
- Create (generated, committed): `web/src/lib/ui/tokens.generated.css`, `apps/ios/Packages/CommishDesign/Sources/CommishDesign/Tokens.generated.swift`, `apps/ios/Packages/CommishDesign/Sources/CommishDesign/Words.generated.swift`, `apps/android/design/src/main/kotlin/app/trycommish/design/Tokens.kt`, `apps/android/design/src/main/kotlin/app/trycommish/design/Words.kt`
- Move: `web/src/lib/format/banned-words.json` to `shared/words/banned-words.json` (the web's test imports the new path; `web/vite.config.ts` `server.fs.allow` gains `../shared`)
- Modify: `web/src/lib/ui/tokens.css` (colour, space, radius and type-size tokens replaced by `@import './tokens.generated.css'`; layout and font-family tokens stay), `api/Makefile` (`check-gen` also runs `node shared/scripts/check-gen.ts`), `web/package.json` (scripts `gen:shared`, `check:shared`)
- Test: `shared/scripts/gen-tokens.test.ts`, `shared/scripts/gen-words.test.ts`, `web/src/lib/ui/tokens-parity.test.ts`

**Interfaces:**
- Produces `shared/design/tokens.json`:

```json
{
  "color": { "ink": { "light": "#15120f", "dark": "#f5f0ea" }, "accent": { "light": "#c2470a", "dark": "#ff7130" } },
  "space": { "s1": 4, "s2": 8, "s3": 12, "s4": 16, "s5": 24, "s6": 32, "s7": 48 },
  "radius": { "sm": 4, "md": 8, "pill": 999 },
  "type": { "xs": 11, "sm": 13, "md": 15, "lg": 18, "xl": 26, "head": 30, "display": 38, "xxl": 44, "xxxl": 88 },
  "font": { "ui": "Outfit", "num": "Big Shoulders Display", "read": "Newsreader" }
}
```

  Every `--<name>` colour token in `tokens.css` becomes `color.<camelName>` with both themes (the dark value from the `prefers-color-scheme` block; a token dark does not redefine carries its light value in both). Type sizes are the pixel values the comments in `tokens.css` state. Layout tokens (`--rail-w`, `--switch-w`, `--row-h`, `--tab-bar-h`, `--touch`, `--verb-h`, `--pin-reserve`, `--side-w`, `--form-w`, `--find-min-w`, `--switch-min-w`, `--measure-week-read`, line heights, `--track-label`, font-family stacks, `--shadow-pop`) stay in `tokens.css`.
- Produces Swift (namespaced, no SwiftUI import, so `swift test` runs on macOS):

```swift
public struct ThemedColor: Sendable, Equatable { public let light: UInt32; public let dark: UInt32 }
public enum Tokens {
    public enum Color { public static let ink = ThemedColor(light: 0x15120F, dark: 0xF5F0EA) /* one per token */ }
    public enum Space { public static let s1: Double = 4 /* ... */ }
    public enum Radius { public static let sm: Double = 4; public static let md: Double = 8; public static let pill: Double = 999 }
    public enum TypeScale { public static let xs: Double = 11 /* ... */ }  // Type is reserved in Swift; Kotlin keeps Tokens.Type
    public enum Font { public static let ui = "Outfit"; public static let num = "Big Shoulders Display"; public static let read = "Newsreader" }
}
```

- Produces Kotlin with the same names (the type scale as `Tokens.Type`) in `object Tokens { object Color { val ink = ThemedColor(0xFF15120F, 0xFFF5F0EA) } ... }` in package `app.trycommish.design`, `data class ThemedColor(val light: Long, val dark: Long)`.
- Produces `shared/words/league-home.json`: the web's `HOME` table from `web/src/lib/league/home/home.ts` as `{ "key": "string" }` for every string-valued member (function-valued members are listed by name under `"functions": [...]` so the apps know which words are built, not copied), exported by `gen-words.ts` importing the TS module through `tsx`; Swift `public enum Words { public enum LeagueHome { public static let week = "Week" /* ... */ } }` and the Kotlin `object Words { object LeagueHome { const val week = "Week" } }`.
- Produces `shared/fixtures/`: `mock-2026-ppr.json` from `web/src/fixtures/mock-2026-ppr.ts`, and the in-season fixture league from `web/scripts/inseason-fixture/` (the FFPC league, its scoreboard answers at the fixture clocks, the platform games) as one JSON per answer the API would give, named by route (`leagues-attached-<id>.json`, `scoreboard-<id>-<clockIso>.json`), with `README.md` naming the fixture clocks.
- Produces `docs/superpowers/specs/2026-10-24-room-protocol.md`: the lobby socket protocol from `web/src/lib/room/lobby-socket.ts` and `api/cmd/room`: the hello (last seq), the welcome (actions since, server `now`), update frames, error frames, the 1008 close and its reasons, the retry ladder `[250, 500, 1000, 2000, 5000]` ms, session affinity, how a command is sent and refused. Every frame as a JSON example.

- [ ] **Step 1: write `gen-tokens.test.ts` first.** It feeds a three-token `tokens.json` to the generator's pure function `render(tokens) -> { css, swift, kotlin }` and asserts: the CSS has `:root { --ink: #15120f; }`, the dark block `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { --ink: #f5f0ea; } }` and `:root[data-theme='dark'] { --ink: #f5f0ea; }`; the Swift has `static let ink = ThemedColor(light: 0x15120F, dark: 0xF5F0EA)`; the Kotlin has `val ink = ThemedColor(0xFF15120F, 0xFFF5F0EA)`; a token with the same value both themes renders both the same. Run `node --test shared/scripts/gen-tokens.test.ts`, expect failure (module missing).
- [ ] **Step 2: write `gen-tokens.ts`** with `render` and a `main` that reads `shared/design/tokens.json` and writes the three files. Run the test, expect pass.
- [ ] **Step 3: build `tokens.json` from `tokens.css`** by a one-off extraction (a script you do not commit, or by hand), then write `tokens-parity.test.ts` in the web: it parses the committed `git show HEAD:web/src/lib/ui/tokens.css` (the pre-change file, read once and saved as `web/src/lib/ui/tokens.before.css.txt` for the test), resolves every colour token in both themes, and asserts equality with the generated CSS. Run `npm test` in `web`, expect the new test to pass and nothing else to change.
- [ ] **Step 4: replace the token block in `tokens.css`** with `@import './tokens.generated.css';` at the top, keeping the layout tokens. Run `npm run check && npm run build` in `web`, then the shot cases (`web/scripts/` shot scripts for the rail, the board, a player page at 390 and 1280, both themes) and compare against main's shots pixel for pixel with the existing compare script; report any differing pixel count (expected 0).
- [ ] **Step 5: `gen-words.test.ts` and `gen-words.ts`.** The test gives a tiny TS-like object `{ week: 'Week', noMoves: 'No moves yet', f: (x: number) => x }` and asserts the JSON `{ "week": "Week", "noMoves": "No moves yet", "functions": ["f"] }`, the Swift `public static let noMoves = "No moves yet"`, the Kotlin `const val noMoves = "No moves yet"`, and that a string with a quote or a newline is escaped in both. Then the generator imports `HOME` through `tsx` and writes the four outputs.
- [ ] **Step 6: `export-fixtures.ts`.** Imports the mock fixture and the in-season fixture modules and writes the JSON files; `shared/fixtures/README.md` lists each file, its route and its clock. A test asserts each JSON parses and the league file carries `id`, `host`, `teams`.
- [ ] **Step 7: move `banned-words.json`** to `shared/words/`, point the web's guard test at it, add `../shared` to Vite's `server.fs.allow`. Run `npm test` in `web`, expect the guard test still to run and pass.
- [ ] **Step 8: `check-gen.ts`** regenerates everything into a temp dir and diffs against the committed files, exit 1 on a difference, printing the paths. Wire it into `api/Makefile` `check-gen` and into `web/package.json` as `check:shared`. Edit one generated byte, run it, expect exit 1; restore, expect exit 0.
- [ ] **Step 9: the room protocol document** from the socket client and the room server. Every frame has a JSON example; the retry ladder and the close code are quoted from the code with file and line.
- [ ] **Step 10: gates and commit.** Web gates (`npm run check`, `npm run lint`, `npm run standin && npm run build`, `npm test`, `node scripts/script-bytes.ts` under 73,728 B gz), `make -C api check-gen`, `node --test shared/scripts/*.test.ts`. Commit in three: the generators and `tokens.json`, the web's switch to the generated CSS with the parity test, the fixtures and the protocol document.

### Task B: app sign-in on the API and the web's landing files (Lane 172)

**Files:**
- Modify: `api/internal/auth/handler.go` (`login` reads `client`, `callback` branches for an app client), `api/internal/auth/bearer.go` (scope `ScopeSession Scope = "session"`, the SignedIn access accepts a device token carrying it), `api/internal/auth/session.go` or the access middleware in `api/internal/httpx` (where `httpx.SignedIn` is enforced), `api/internal/devices/service.go` and `store.go` (device `kind` column: `extension`, `ios`, `android`; `pair` mints the session scope for an app kind; `MaxDevices` unchanged), `api/openapi.yaml` (`client` and `return_to` parameters on `/auth/login`, `kind` on `PairInput` and `Device`, the `device` security scheme noted on signed-in routes), a goose migration adding `kind text not null default 'extension'` to the devices table
- Create: `web/src/routes/app/signed-in/+page.svelte` and `+page.ts` (prerendered; says "Open Commish" and, when the app did not take the link, how to install, with the code never shown), `web/static/.well-known/apple-app-site-association` and `web/static/.well-known/assetlinks.json` (served with `application/json`; the Apple team id and the Android certificate digest read from repository variables `APPLE_TEAM_ID` and `ANDROID_CERT_SHA256` at build by `web/scripts/well-known.ts`, with an empty value producing a file that claims nothing)
- Test: `api/internal/auth/handler_test.go`, `api/internal/auth/bearer_test.go`, `api/internal/devices/devices_test.go`, `web/src/routes/app/signed-in/page.test.ts`, `web/scripts/well-known.test.ts`

**Interfaces:**
- `GET /auth/login?client=ios|android&return_to=<url>&code_challenge=<challenge>&code_challenge_method=S256` (as built, Lane 172 fix round 1): the app makes a fresh `code_verifier` for each sign-in (43 to 128 characters of `A-Z a-z 0-9 - . _ ~`, from 32 or more random bytes) and sends `code_challenge` = base64url(SHA-256(verifier)) with no padding (exactly 43 characters) and `code_challenge_method=S256`. `return_to` must be exactly `https://trycommish.app/app/signed-in` (the API's `PublicBaseURL` plus `/app/signed-in`) or absent. Anything else is the API's 400 naming the one field at fault in `error.fields` (`client`, `return_to`, `code_challenge_method` or `code_challenge`), before AuthKit is asked. The sealed state carries `client` and the challenge. Without `client` the web's sign-in is unchanged and the challenge is ignored.
- `GET /auth/callback`: for an app client, after the session is created as today, the handler mints a pairing code bound to the app's kind and the sealed challenge (`devices.Service.AppCode`, the ten-minute code, stored with `kind` and `code_challenge` on `device_pair_codes`), then redirects `303` to `https://trycommish.app/app/signed-in?client=<client>&code=<six words>`. The link is built from config, never from the request. The apps parse the query by name. The browser session cookie is still set (harmless in the system sheet).
- `POST /devices/pair` body `{"code": "...", "name": "Justin's iPhone", "kind": "ios", "code_verifier": "..."}`: a `kind` of `ios` or `android` requires `code_verifier`. A missing or malformed one is 400 with field `code_verifier`. One whose S256 challenge does not match the code's is the same 400 as a used or expired code (field `code`). A refused pair spends nothing, so the app that holds the verifier still pairs. The app kinds mint the token with scopes `session`, `league:write`, `draft:write`. `extension` (the default when absent) needs no verifier, pairs only the account page's code and keeps today's two scopes. Answer unchanged (`Paired`: the device, now with `kind`, and its token).
- Access rule: a request with `Authorization: Bearer <device token>` whose token carries `session` passes `httpx.SignedIn` as that device's account; without `session` it opens only `httpx.Device` routes as today. CSRF is not required on bearer requests (nothing a browser sends on its own carries the header). An app's token lapses like a browser session: unused for `auth.SessionTTL` (30 days, from its last use, noted to the hour) it opens nothing, and the app signs in again. Sign-out in an app is `DELETE /devices/{its own id}`: `/auth/logout` does not revoke the device.
- Web: `/app/signed-in` renders the words from `web/src/lib/site/app-words.ts` (`OPEN_APP = 'Open Commish'`, `NO_APP = 'The app did not open. Install Commish from the App Store or Google Play, then sign in again.'`), never prints the query string.

- [ ] **Step 1: bearer test first.** In `bearer_test.go`: a token with scopes `[session]` on a `SignedIn` route answers 200 as the account; a token with `[league:write]` answers 401 on the same route; a session cookie still works. Run `go test ./internal/auth/...`, expect the first case to fail.
- [ ] **Step 2: implement the session scope** in `bearer.go` and the `SignedIn` check, smallest change. Run the tests, expect pass. Run the whole API suite once to see nothing else moved.
- [ ] **Step 3: handler tests.** `login` with `client=ios` and the exact `return_to` seals the client; with a foreign `return_to` answers 400; `callback` for an app client ends in a 303 to the return with a `code` query that the devices store accepts once. Run, expect failures, implement, expect pass.
- [ ] **Step 4: devices.** Migration for `kind`; `pair` reads `kind`, validates it against the three words, mints scopes by kind; `list` carries `kind`. Tests: an `ios` pair carries `session`; an `extension` pair does not; an unknown kind is 400. Run `make check-gen` after editing `openapi.yaml`; commit the regenerated Go and TypeScript.
- [ ] **Step 5: the web landing page and the well-known files.** `page.test.ts` renders the page with `?code=abc` and asserts `abc` is not in the HTML and `Open Commish` is. `well-known.test.ts` renders both files from `APPLE_TEAM_ID=ABCDE12345` and the digest and asserts the JSON shapes (`applinks.details[0].appIDs == ["ABCDE12345.app.trycommish.ios"]`, `paths` carries `/app/signed-in`, `/players/*`, `/league/*`, `/mock/share/*`; `assetlinks` names `app.trycommish.android` with the digest); with empty variables both files carry no app ids.
- [ ] **Step 6: deploy-pair check.** The new web against the old API (no `kind`): the page is static, nothing to parse. The new API against the old web: `/auth/login` without `client` behaves exactly as before (a test asserts the redirect target is unchanged).
- [ ] **Step 7: gates and commit.** API: `gofmt -l`, `go vet`, `go build`, `make check-gen` after web lint, `CI=true TEST_DATABASE_URL=postgres://commish:commish@localhost:5433/lane172_api go test -race -count=1 -p 1 ./...`. Web gates as in Task A. Two commits: the API, the web.

### Task C: the iOS app, sign-in and the League home (Lane 173)

**Files:**
- Create: `apps/ios/project.yml` (XcodeGen: app target `Commish`, bundle id `app.trycommish.ios`, iOS 17.0, Swift 6, associated domains `applinks:trycommish.app`, the four local packages), `apps/ios/Commish/` (`CommishApp.swift`, `RootTabs.swift`, `SignIn/SignInFlow.swift` using `ASWebAuthenticationSession` with the callback URL scheme left empty and the universal link handled in `onOpenURL`, `Assets.xcassets` with the whistle icon drawn from `web/src/lib/ui/mark.ts` by a script `apps/ios/scripts/app-icon.ts`), `apps/ios/Packages/CommishAPI` (Package.swift with `swift-openapi-generator` as a plugin, `openapi.yaml` symlinked from `api/openapi.yaml`, `openapi-generator-config.yaml` generating types and client, `Sources/CommishAPI/Transport.swift` adding `Authorization: Bearer` and `X-Request-Id`), `apps/ios/Packages/CommishDesign` (Task A's generated files plus `Theme.swift` mapping `ThemedColor` to SwiftUI `Color` by colour scheme, `Faces.swift` for the three faces with system fallbacks, `BoxTable.swift`, `Pill.swift`, `Mark.swift`), `apps/ios/Packages/CommishCore` (`Clock.swift` protocol with `SystemClock` and `FixedClock`, `Session.swift` keychain store, `Cache.swift` file cache keyed by route with the answer's stamp, `LeagueHome/LeagueHomeModel.swift` mapping the generated types to the screen's rows using `Words.LeagueHome`, `LeagueHome/LeagueHomeViewModel.swift`), `apps/ios/Packages/Features/LeagueHome` (`LeagueHomeView.swift`, `ScoreBoardView.swift`, `StandingsView.swift`, `MovesFeedView.swift`), `apps/ios/fastlane/Fastfile` (`beta` lane: build, `pilot` upload when `ASC_KEY_ID` is set), `.github/workflows/ios.yml`
- Test: `apps/ios/Packages/CommishCore/Tests/` (view model against `shared/fixtures` with `FixedClock`; cache fallback with a failing transport), `apps/ios/Packages/Features/LeagueHome/Tests/` (snapshot tests with swift-snapshot-testing, light and dark, iPhone 15 and iPhone SE sizes; the recorded snapshots committed), a banned-words test over `Localizable.xcstrings`

**Interfaces:**
- Consumes Task A's `Tokens` and `Words.LeagueHome`, `shared/fixtures/inseason/*.json`, Task B's sign-in (`/auth/login?client=ios&return_to=https://trycommish.app/app/signed-in&code_challenge=<S256>&code_challenge_method=S256`, the universal link with `code`, `POST /devices/pair` with `kind: "ios"` and `code_verifier`).
- Produces the pattern every later screen lane copies: `Model` (pure, tested), `ViewModel` (`@Observable`, takes `APIClient`, `Cache`, `Clock`), `View` (SwiftUI, reads the theme), snapshot tests as the mock.
- `LeagueHomeViewModel.load(leagueID:)` returns from the cache first when present, then refreshes; `state: .loading | .loaded(LeagueHomeModel, stamp: Date, stale: Bool) | .failed(String)`.

- [ ] **Step 1: packages build on macOS.** `swift build` and `swift test` in each package with the Command Line Tools (Xcode is not on this machine; the app target builds in CI). The Design and Core packages must not import UIKit at module level.
- [ ] **Step 2: Core tests first.** `LeagueHomeModelTests`: from `shared/fixtures/inseason/leagues-attached-<id>.json` and the scoreboard at the fixture's Sunday clock, the rows carry the web's words (`Words.LeagueHome.week`, the standings order, the moves feed's `noMoves` when empty). `LeagueHomeViewModelTests`: a transport that throws plus a warm cache yields `.loaded(stale: true)`; a cold cache yields `.failed` with a member-facing sentence, never an error code. Run, expect failures; implement; expect pass.
- [ ] **Step 3: the API package.** Generate the client from `api/openapi.yaml`; a test decodes `shared/fixtures/inseason/leagues-attached-<id>.json` into the generated type, and decodes the same file with an unknown extra field added (additive tolerance).
- [ ] **Step 4: the Design package.** `Theme` resolves `Tokens.Color.ink` to the light value in `.light` and the dark value in `.dark`; `BoxTable` lays out columns with tabular numerals in the number face; `Mark` draws the path from `web/src/lib/ui/mark.ts` (copied once by the icon script into `Mark.generated.swift`, drift-checked by Task A's `check-gen.ts`, which gains this file).
- [ ] **Step 5: the feature and the app.** `LeagueHomeView` composes the three sections with the web's section order (`web/src/lib/league/LeaguePage.svelte`: scoreboard, standings, lineup summary, moves). Five tabs in `RootTabs` with the web's names and order; only League is live, the rest show the screen's name and nothing else. Sign-in flow end to end against the dev API on this machine (`API_BASE_URL` build setting; the dev API at its usual port, never production). The app makes a fresh PKCE `code_verifier` for each sign-in, keeps it in memory for that flow only (never on disk, never logged), sends its S256 `code_challenge` on `/auth/login` and the verifier on `POST /devices/pair`, and ignores a link that arrives with no flow in progress.
- [ ] **Step 6: snapshots.** Record light and dark at iPhone 15 and iPhone SE for the League home from the fixture at the fixture clock; commit them under `__Snapshots__`. These are the mocks: write `lane-173-personas.md` from them before reporting.
- [ ] **Step 7: CI.** `ios.yml`: on push to main and on branches touching `apps/ios/**`, `shared/**`, `api/openapi.yaml`; `macos-15` runner, Xcode pinned, SwiftPM cache, `xcodegen generate`, `xcodebuild -scheme Commish -destination 'platform=iOS Simulator,name=iPhone 15' build test`, then `fastlane beta` only on main and only when `secrets.ASC_KEY_ID` is non-empty (the step says so in its name when skipped). Push the branch and read the run.
- [ ] **Step 8: gates and commit.** `swift test` per package, SwiftLint and SwiftFormat check (installed by brew), the banned-words test, `make -C api check-gen`. Commits per package, then the app, then CI.

### Task D: the Android app, sign-in and the League home (Lane 174)

**Files:**
- Create: `apps/android/settings.gradle.kts`, `build.gradle.kts`, `gradle/libs.versions.toml`, the Gradle wrapper (8.x), `app/` (application id `app.trycommish.android`, minSdk 26, targetSdk 35, Compose BOM, `MainActivity`, `RootTabs.kt`, `SignInFlow.kt` with Custom Tabs and an intent filter for `https://trycommish.app/app/signed-in` with `android:autoVerify="true"`, the launcher icon from the same mark script), `api/` (openapi-generator Gradle plugin, `kotlin` generator with `library=jvm-ktor`, `serializationLibrary=kotlinx_serialization`, `Transport.kt` adding the bearer and the request id), `design/` (Task A's generated `Tokens.kt` and `Words.kt`, `Theme.kt` mapping to Material 3 colour schemes for both themes, `Faces.kt`, `BoxTable.kt`, `Pill.kt`, `Mark.kt`), `core/` (`Clock.kt`, `Session.kt` with EncryptedSharedPreferences, `Cache.kt`, `leaguehome/LeagueHomeModel.kt`, `leaguehome/LeagueHomeViewModel.kt`), `feature/leaguehome/` (`LeagueHomeScreen.kt`, `ScoreBoard.kt`, `Standings.kt`, `MovesFeed.kt`), `apps/android/fastlane/Fastfile` (`internal` lane: `supply` to the internal track when `PLAY_JSON_KEY` is set), `.github/workflows/android.yml`
- Test: `core/src/test/` (view model against `shared/fixtures` with a fixed clock; cache fallback), `feature/leaguehome/src/test/` (Paparazzi snapshots, light and dark, Pixel 8 and a small phone; committed), a banned-words test over `strings.xml`

**Interfaces:** the same as Task C with Kotlin names: `LeagueHomeViewModel.load(leagueId)`, `sealed interface State { Loading; Loaded(model, stamp, stale); Failed(message) }`.

- [ ] **Step 1: toolchain.** `JAVA_HOME` from `brew --prefix openjdk@17`, `ANDROID_HOME=$HOME/Library/Android/sdk` (installed by the coordinator; if a package is missing, `sdkmanager` it and say so). `./gradlew help` runs.
- [ ] **Step 2: Core tests first**, the same cases as Task C step 2, with JUnit 5 and kotlinx-coroutines-test. Run, expect failures; implement; expect pass.
- [ ] **Step 3: the API module.** Generate; a test decodes the fixture and the fixture with an extra field (`ignoreUnknownKeys = true` in the JSON config, asserted).
- [ ] **Step 4: Design.** `Theme` resolves both schemes; `BoxTable` with tabular figures; `Mark` from the same generated path.
- [ ] **Step 5: the feature and the app.** The same section order and the same five tabs as Task C. Sign-in against the dev API in the emulator (`10.0.2.2` for the host). The app makes a fresh PKCE `code_verifier` for each sign-in, keeps it in memory for that flow only (never on disk, never logged), sends its S256 `code_challenge` on `/auth/login` and the verifier on `POST /devices/pair`, and ignores a link that arrives with no flow in progress.
- [ ] **Step 6: Paparazzi snapshots** light and dark at two sizes; `./gradlew verifyPaparazziDebug` passes against the committed images; personas from them in `lane-174-personas.md`.
- [ ] **Step 7: CI.** `android.yml`: Ubuntu, JDK 17, Gradle cache, `./gradlew lint testDebugUnitTest verifyPaparazziDebug assembleDebug`, then `fastlane internal` only on main with the Play key present; the step says so when skipped. Push the branch and read the run.
- [ ] **Step 8: gates and commit.** `./gradlew lint testDebugUnitTest verifyPaparazziDebug assembleDebug`, ktlint, the banned-words test, `make -C api check-gen`. Commits per module, then the app, then CI.

### Task E: the coordinator's merge order and the founder's steps

Not a lane. Task A merges first (C and D consume its generated files). Task B merges second (C and D sign in against it on dev). Tasks C and D run in parallel after A and are merged in the order they pass review. After each merge the coordinator runs the deploy-pair check and reads the three workflows. Founder steps, asked once in one message and never blocking a lane: install Xcode from the App Store on this machine; enrol Commish LLC in the Apple Developer Program and open a Google Play Console; create the Firebase project; enable Apple as a sign-in provider in WorkOS; set repository variables `APPLE_TEAM_ID` and `ANDROID_CERT_SHA256` when they exist; paste the App Store Connect API key, the Play service account and the APNs key in chat.
