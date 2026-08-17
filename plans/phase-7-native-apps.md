# Blueprint: Commish — Phase 7: Native Mobile Apps (iOS & Android)

**Objective:** Build real native iOS and Android clients against the backend delivered in Phases 1–6, so real-money users get an actual app — not the thin iframe wrapper Apex's users reportedly get via MyFantasyLeague's mobile apps (strategy doc §1.1, §4). Ship a shared, drift-proof API contract, native draft-room and roster experiences on both platforms, real backend-driven push notifications, and mobile-specific reliability hardening against the same peak-concurrency failure mode that took down ESPN Fantasy in 2025 — before any store submission.

**Source strategy doc:** `docs/research/2026-08-16-beating-apex-strategy.md` (Sections 1.1, 4, 5)

**Depends on:** Phase 2 at minimum (a stable, authenticated API surface — nothing native can be built against a moving target). Full feature parity with the web app additionally depends on Phases 3–6 (money/payments, tax, compliance, AI advisory) — see "Relationship to Phases 2–6" below for how this phase overlaps with, rather than strictly waits on, that work.

**Mode:** Direct, following Phase 1's conventions. Assumes Phases 1–2 have produced a running Next.js backend with an authenticated API and the Phase 1 draft/scoring engines described below.

> **Step-number reconciliation:** this file was drafted against an earlier draft of Phase 1 that had 9 steps, where league management was Step 6 and the combined draft-room (snake + auction) was Step 4. Phase 1 was later rewritten to 11 steps: league management is now **Step 7**, the real-time transport and event namespace are now scaffolded in **Step 1** (`docs/conventions.md`) and wired up for snake drafting specifically in **Step 4**, with auction split into its own **Step 5**. Wherever this file says "Phase 1 Step 4's event protocol," read it as the namespace defined in Phase 1's `docs/conventions.md` (Step 1); wherever it says "Phase 1 Step 6," read **Step 7**. See `plans/00-roadmap.md` for the full mapping.

**Revision note (v2):** A scaling review and a UX review found two gaps in this phase (`docs/research/2026-08-16-scaling-review.md` I8, `docs/research/2026-08-16-ux-review.md` I7; see `00-roadmap.md`'s "Scaling & UX review" section for the assignment of these findings to this phase). **UX (I7):** the original spec for Steps 2 and 3 was feature-parity porting, not native-feel design — no reference to Apple's HIG or Material Design anywhere, zero haptics in a product whose entire premise is tactile anticipation, no Dynamic Type/font-scale support, and Step 3's own context brief stated parity as "if a screen, error state, or interaction exists on iOS, it should exist here too, and vice versa" — parity discipline, the opposite of platform-idiomatic design. Fixed: platform-native navigation/haptics/Dynamic-Type tasks and a native-platform design-review exit criterion added to Steps 2 and 3; Step 3's context brief now states explicitly that feature parity means the same *capabilities* exist on both platforms, not the same look or feel. A new **Step 5 — Platform-native live surfaces** was also added, covering iOS Live Activities/Dynamic Island and Android home-screen widgets — named in the review as "a near-perfect, Apex-unavailable fit" and a currently-unclaimed differentiator that the original plan never scheduled at all. **Scaling (I8):** Redis (the shared real-time layer this app's SSE client connects to) has no documented HA/persistence policy — that's Phase 2's infrastructure decision, not this phase's — but this phase does rely on an assumption about it; that assumption is now recorded explicitly in the reliability step's context brief rather than left implicit.
>
> **Step numbering changed as a result:** a new **Step 5 — Platform-native live surfaces** is inserted after the push-notification step. The former Step 5 (developer accounts/store listings) is now **Step 6**; the former Step 6 (native reliability & performance tuning) is now **Step 7**. If any other phase file or `00-roadmap.md` cross-references this file's old Step 5 or Step 6, update it to Step 6 or Step 7 respectively.

**Stack decisions (made by default, flag for correction at Step 1):**
- **iOS: native Swift + SwiftUI** (not React Native/Expo). Justification in Step 2's context brief — short version: this is a real-time, high-reliability, real-money product where the draft room is the core competitive wedge (strategy doc §1.1), and Phase 1's draft engine is already server-authoritative (a reducer the client only renders and dispatches actions against — see Phase 1 Step 3). That removes React Native's main selling point (sharing business logic in JS) while keeping its downsides (bridge overhead, slower access to background execution and push APIs, an extra runtime layer between the app and exactly the reliability guarantees Section 5 of the strategy doc calls out as the highest-leverage failure mode to avoid). Full native maximizes performance and platform-native reliability control for both apps.
- **Android: native Kotlin + Jetpack Compose** — same justification, mirrored.
- **Shared contract: OpenAPI 3.1, generated from the backend's own Zod schemas, not hand-maintained** — not tRPC. tRPC's compile-time type sharing only extends to TypeScript consumers; it buys nothing for Swift/Kotlin clients. Zod-schema-per-route (already implied by this codebase's input-validation-at-boundaries convention) → `zod-to-openapi` → one generated `openapi.json` → `swift-openapi-generator` for iOS and `openapi-generator` (Kotlin/Ktor target) for Android. One source of truth, three consumers (web, iOS, Android), zero hand-kept duplication.
- **Real-time transport: the same SSE stream the web app consumes** (Redis Streams fanned out over Server-Sent Events, per Phase 1's "Real-time & event architecture" section — no Socket.io, no managed pub/sub vendor). SSE is plain long-lived HTTP with a simple text protocol, so both platforms consume it with their standard networking stack — `URLSession` on iOS (`bytes(for:)` streaming), `OkHttp` on Android (a streaming response body) — rather than a vendor SDK. One less third-party dependency per platform, and nothing to keep in version-lockstep with a Socket.io server upgrade. Redis is entirely server-side — native clients never talk to it directly, only to the SSE endpoint.
- **Push delivery: Firebase Cloud Messaging (FCM) for both platforms**, including iOS (FCM delivers over APNs under the hood on Apple's side) — one backend delivery integration and one delivery-tracking surface instead of separate APNs + FCM pipelines.

---

## Relationship to Phases 2–6

This is a genuine parallel-track opportunity, not a strict "wait for everything" dependency:

- **Step 1 (API contract) can start the moment Phase 2's API is stable.** Steps 2 and 3 (the iOS and Android scaffolds, draft room, and roster views) can then proceed **in parallel with Phases 3–6 continuing on the backend/web side** — those phases build money movement, tax, compliance, and AI advisory into the *web* app and backend; they don't block writing SwiftUI and Compose screens against the already-stable draft/scoring/roster API surface from Phases 1–2.
- **What the native apps cannot do until Phases 3–6 land:** ship real entry fees, payouts, KYC-gated withdrawal flows, tax-driven UI (1099 status, W-9 collection), or the AI advisory surfaces those phases introduce. Step 4 below builds the *payout-confirmation push path* as a ready-to-fire contract now, deliberately, so the eventual payments phase only has to emit an event — not build mobile delivery from scratch.
- **Net effect:** treat Steps 1–3, 5, and 7 as startable as soon as Phase 2 ships, running alongside Phases 3–6. Treat full production feature parity — and certainly public store submission (Step 6) — as gated on those phases actually landing.

---

## Dependency Graph

```
Phase 2 (stable authenticated API)
   └─→ Step 1 (shared OpenAPI contract + generated Swift/Kotlin SDKs)
          ├─→ Step 2 (iOS scaffold: draft room + roster, SwiftUI)    ─┐
          ├─→ Step 3 (Android scaffold: draft room + roster, Compose) ─┤
          │                                                            ├─→ Step 4 (push notification infra)
          │                                                            │        │
          │                                                            │        └─→ Step 5 (platform-native live
          │                                                            │                 surfaces: Live Activities /
          │                                                            │                 Dynamic Island, Android
          │                                                            │                 widgets, quick-actions)
          │                                                            │                 │
          │                                                            └─────────────────┴─→ Step 7 (mobile
          │                                                                                    reliability & perf.)

Step 6 (Apple Developer Program + Google Play Developer account,
        store listings, submission planning)
   — runs independently, start as early as legally possible —
   gates App Store / Play Store SUBMISSION only; does not block
   Steps 1–5/7 coding work.

Phases 3–6 (web/backend: money, tax, compliance, AI advisory)
   ┄┄┄ parallel track ┄┄┄ required for full feature parity and
   for a real-money production release, NOT required to begin
   Step 1 or the Step 2/3 scaffolds.
```

**Parallel opportunity:** Steps 2 and 3 don't share a codebase (Xcode project vs. Gradle project) and both consume the same Step 1 contract read-only — they can be built by two different agents/sessions concurrently. Step 5 (platform-native live surfaces) has no code dependency on Step 6 (business/store setup) and the two can proceed concurrently once Step 5's own prerequisites (Steps 2–4) are done. Step 6 has no code dependency on anything in this phase and should be kicked off as early as organizationally possible, since Apple Developer Program enrollment (entity verification, D-U-N-S lookup) can take one to two weeks on its own.

---

## Step 1 — Shared API contract & generated typed client SDKs

**Model tier:** strongest (architecture-defining; a wrong choice here causes silent drift between web, iOS, and Android for the rest of the project's life)
**Depends on:** Phase 2 (stable authenticated API)
**Parallel with:** Phases 3–6 continuing on the backend/web side

### Context brief
Three clients (Next.js web, native iOS, native Android) now consume one backend. Without a single generated source of truth, they drift silently — someone changes a response shape for the web app and breaks the Android app weeks later with no compiler error anywhere. The fix is to make the backend's own request/response validation schemas the single source of truth, mechanically derive an OpenAPI document from them, and mechanically generate both native clients from that document. Nobody hand-writes or hand-edits a client model on any platform, ever — that's the rule this step exists to enforce.

### Tasks
- [ ] Audit every Phase 2 API route; ensure each has an explicit Zod schema for its request and response shapes (add any that are missing — this is also just good input-validation practice at the system boundary)
- [ ] Add `zod-to-openapi` (or equivalent) to the backend; wire an `npm run generate:openapi` script that walks all route schemas and emits `contracts/openapi.json`
- [ ] Commit `contracts/openapi.json` as a generated build artifact (regenerated by the script, never hand-edited) in a shared `contracts/` directory versioned alongside the backend
- [ ] Add `scripts/generate-ios-client.sh` using `swift-openapi-generator` to emit an async/await Swift client + `Codable` models from `contracts/openapi.json` into `ios/Generated/` (gitignored, regenerated on build)
- [ ] Add `scripts/generate-android-client.sh` using `openapi-generator` (Kotlin generator, Ktor client library) to emit into `android/generated/` (gitignored, regenerated on build)
- [ ] Add a CI/npm check (`npm run verify:openapi-fresh`) that regenerates the spec into a temp file and diffs it against the committed one, failing the build on drift
- [ ] Write a contract test that starts a Phase 2 dev server, hits every documented endpoint, and validates the live response against the OpenAPI schema (e.g., via a schema-diff/validation library) — catches the case where the spec is fresh but the *implementation* doesn't match it
- [ ] Document the rule in `contracts/README.md`: no endpoint ships without a Zod schema; no generated client file is ever hand-edited; regeneration is part of every PR that touches an API route

### Verification
```bash
npm run generate:openapi
npm run verify:openapi-fresh
./scripts/generate-ios-client.sh --check
./scripts/generate-android-client.sh --check
npm test -- contract
```

### Exit criteria
- `contracts/openapi.json` covers 100% of Phase 2's authenticated API surface, generated (not hand-written) from Zod schemas
- Both native clients generate cleanly with zero manual post-generation edits required
- The contract test passes against a running Phase 2 dev server
- CI fails if the backend's schemas and the committed spec diverge

### Rollback
Entirely generated-artifact and tooling; deleting `contracts/` and the generated client directories has no effect on the backend itself or on Phase 2's routes.

---

## Step 2 — iOS app scaffold (Swift/SwiftUI): draft room & roster

**Model tier:** strongest (architecture-defining for the iOS codebase; highest correctness risk is real-time draft state rendering)
**Depends on:** Step 1
**Parallel with:** Step 3 (separate codebase, same read-only contract)

### Context brief
This is the first real native surface of the platform's core competitive wedge (strategy doc §1.1, §4): one proprietary draft engine, rendered natively, with no third-party hand-off and no web-view wrapper. Phase 1 Step 3 already built the draft engine as a server-authoritative pure reducer — the iOS app's job is to render that state and dispatch actions against it, never to reimplement draft-legality rules locally. Keep that boundary as firm here as Phase 1 kept it between its engine and its web UI: if pick-validation logic starts appearing in a SwiftUI view, that's a sign of scope creep, not a legitimate shortcut.

### Tasks
- [ ] Scaffold an Xcode project (SwiftUI app lifecycle, iOS 17+ minimum to use modern structured concurrency cleanly)
- [ ] Add the Step 1 generated Swift client as a local Swift Package dependency
- [ ] Build a minimal SSE client over `URLSession` for the real-time draft/chat channel, parsing the same `eventType`/payload taxonomy defined in Phase 1's `docs/conventions.md` exactly (no iOS-specific reinterpretation) — this is a small, well-understood text protocol (event/data lines over a streaming HTTP response), not something that needs a library
- [ ] Implement the auth flow against Phase 2's endpoints: token storage in Keychain (never `UserDefaults`), silent refresh, and a clear signed-out state
- [ ] Build the draft room screen: searchable/filterable player pool, live-filling team rosters, pick-clock countdown, auction nomination/bid UI — driven entirely by state pushed from the server via SSE events plus the Step 1 REST client for initial load. **The acting user's own pick renders optimistically** (instantly on submit, reconciled against the server response), matching the web app's real-time architecture rationale
- [ ] Build the roster/lineup screen (porting Phase 1 Step 7): starters vs. bench, position-slot display, with invalid-lineup errors surfaced verbatim from the server's rejection reason — not re-derived client-side
- [ ] **Platform-native navigation & interaction idioms** — a UX review found the original spec here named the right framework (SwiftUI) but then specified nothing beyond it, with no reference anywhere to Apple's Human Interface Guidelines and no platform-native navigation pattern chosen. Fix: adopt tab bar + large titles + swipe-back navigation and standard SwiftUI interaction idioms per HIG. **Parity with the Android app (Step 3) means the same capabilities exist on both platforms, explicitly not the same visual or interaction identity** — where iOS and Material 3 diverge, follow iOS, and record each intentional divergence in a shared `docs/mobile-parity.md` (create it if Step 3 hasn't yet, since these steps run in parallel — both append to the same file)
- [ ] **Haptic feedback** — the same review found zero haptic occurrences anywhere in the original spec, despite the strategy doc's whole premise being tactile anticipation. Fix: implement haptic feedback (`UIFeedbackGenerator`) on: your pick registering, being outbid in an auction, your turn starting, a lineup-lock warning, and a payout confirmation — intensity driven by a config value, not hardcoded, and respecting the system's Reduce Motion / haptics settings
- [ ] **Dynamic Type support** — add Dynamic Type support across the draft room and roster screens, verified to the largest accessibility text size without truncation or clipped layout
- [ ] Implement basic backgrounding behavior: close the SSE connection on background rather than leaving it open indefinitely off-screen, do a full state resync on foreground (deep reconnect hardening is Step 7 — keep this step's version simple and correct, not exhaustive)
- [ ] Unit-test view models (state transitions driven by SDK responses and SSE events) with XCTest; add XCUITest coverage for the critical path: sign in → join draft → make a pick → view updated roster

### Verification
```bash
xcodebuild -scheme FantasyApp -destination 'platform=iOS Simulator,name=iPhone 15' test
swiftlint
```

### Exit criteria
- App builds and runs in the iOS Simulator against a running Phase 1/2 dev backend
- A signed-in user can view the draft room and see live pick updates streamed from the server in real time
- The roster/lineup screen renders correctly and displays server-driven validation errors for an invalid lineup, with no duplicated position-eligibility logic on-device
- Code review confirms no draft-legality decision (turn order, pick validity, roster-slot rules) is made client-side — every action round-trips through the API, with results only ever confirmed via the SSE stream or the API response
- **A native-platform design review confirms the app reads as an iOS app, not a ported web app** — specifically navigation, typography, motion, and haptics — with any intentional iOS/Android divergence recorded in `docs/mobile-parity.md`

### Rollback
Self-contained Xcode project directory; deleting it doesn't touch the backend, the contract in Step 1, or the Android app in Step 3.

---

## Step 3 — Android app scaffold (Kotlin/Jetpack Compose): draft room & roster

**Model tier:** strongest (same rationale as Step 2 — architecture-defining, real-time-state correctness risk)
**Depends on:** Step 1
**Parallel with:** Step 2

### Context brief
Mirrors Step 2 on Android, consuming the same Step 1 contract and the same Phase 1 server-authoritative draft/scoring engines. Do not let the two platforms' *feature sets* drift — if a screen, error state, or interaction exists on iOS, an equivalent capability should exist here too, and vice versa; the shared OpenAPI contract keeps the *data* in sync, but feature-set parity across the two UIs is a human/process discipline, not something codegen enforces. **A UX review found this framing, as originally written ("if a screen... exists on iOS, it should exist here too"), reads as parity discipline in the visual/interaction sense too — the opposite of platform-idiomatic design, and the reason the original spec had no Material Design guidance anywhere. Fix, applied here and mirrored in Step 2: parity means feature parity, explicitly not visual or interaction identity — where iOS's HIG and Android's Material 3 diverge (as they routinely do), follow the platform, and record each intentional divergence in a shared `docs/mobile-parity.md` (create it if Step 2 hasn't yet, since these steps run in parallel — both append to the same file).**

### Tasks
- [ ] Scaffold a Gradle project with Jetpack Compose (Material 3), minimum SDK chosen to support modern Compose + Kotlin coroutines cleanly
- [ ] Add the Step 1 generated Kotlin/Ktor client as a project module dependency
- [ ] Build a minimal SSE client over OkHttp's streaming response body for the real-time draft/chat channel, parsing the same `eventType`/payload taxonomy defined in Phase 1's `docs/conventions.md` exactly
- [ ] Implement the auth flow against Phase 2's endpoints: token storage via `EncryptedSharedPreferences` (or the Android Keystore-backed equivalent), silent refresh, clear signed-out state
- [ ] Build the draft room screen in Compose: player pool with search/filter, live team rosters, pick-clock countdown, auction nomination/bid UI — server-driven state only, mirroring Step 2's feature set, including Step 2's optimistic-render-on-submit pattern for the acting user's own pick
- [ ] Build the roster/lineup screen (porting Phase 1 Step 7): starters vs. bench, position-slot display, server-sourced validation error messages
- [ ] **Platform-native navigation & interaction idioms** — the same UX review that flagged Step 2 found no Material Design guidance anywhere in the original spec either. Fix: adopt bottom navigation + a Material top app bar and standard Compose/Material 3 interaction idioms — parity with iOS (Step 2) means the same capabilities exist on both platforms, explicitly not the same visual or interaction identity; where Material 3 and HIG diverge, follow Material 3, and record each intentional divergence in the shared `docs/mobile-parity.md` (create it if Step 2 hasn't yet, since these steps run in parallel — both append to the same file)
- [ ] **Haptic feedback** — implement haptic feedback (Compose's haptic feedback API / `View.performHapticFeedback`) on the same five moments as iOS: your pick registering, being outbid in an auction, your turn starting, a lineup-lock warning, and a payout confirmation — intensity driven by a config value, not hardcoded, and respecting the system's haptics/vibration settings
- [ ] **Font-scale support** — Android's equivalent of Dynamic Type: verify the draft room and roster screens render correctly at the largest system font-scale setting without truncation or clipped layout
- [ ] Implement basic backgrounding behavior via Android lifecycle observers: close/reopen the SSE connection appropriately on `ON_STOP`/`ON_START`, full state resync on resume (deep hardening deferred to Step 7)
- [ ] Unit-test ViewModels/state holders (using `Turbine` for Flow testing) and add Compose UI tests / Espresso coverage for the critical path: sign in → join draft → make a pick → view updated roster

### Verification
```bash
./gradlew test
./gradlew connectedAndroidTest
./gradlew ktlintCheck
```

### Exit criteria
- App builds and runs on an Android emulator/device against a running Phase 1/2 dev backend
- A signed-in user can view the draft room and see live pick updates streamed from the server in real time
- The roster/lineup screen renders correctly with server-driven validation errors, no duplicated eligibility logic on-device
- Feature parity check against Step 2 passes: same screens, same error states, same core interactions — same *capabilities*, not the same look or feel
- **A native-platform design review confirms the app reads as an Android app, not a ported web app** — specifically navigation, typography, motion, and haptics — with any intentional iOS/Android divergence recorded in `docs/mobile-parity.md`

### Rollback
Self-contained Gradle project directory; deleting it doesn't touch the backend, the contract in Step 1, or the iOS app in Step 2.

---

## Step 4 — Push notification infrastructure

**Model tier:** strongest (cross-cutting backend event design; wiring mistakes here mean silently missed money-relevant alerts, which is a trust failure, not just a bug)
**Depends on:** Step 1 (device-registration contract), Step 2, Step 3 (need real app shells to receive and route pushes), Phase 2 (auth, to associate a device token with a user)
**Parallel with:** nothing meaningful — this step touches backend event emission and both native apps at once

### Context brief
Strategy doc §4 and §1.4 are explicit: draft-turn alerts, lineup-lock countdowns, live scoring swings, and payout confirmations must be **contextual pushes tied to real backend events**, not client-side polling — Sleeper's "deliberately restrained, personalized" model (§1.2) is the bar, and blast-style over-notification is the failure mode to avoid. This step defines four typed events, emits them from the real backend systems that already know when they happen (Phase 1's draft engine, scoring engine, and a lock-timer scheduler), and delivers them via FCM to both native apps. The payout-confirmation path is built as a ready contract now even though no payments engine exists yet (that lands in Phases 3–6) — so that phase only has to call an existing emitter, not invent mobile delivery from scratch.

### Tasks
- [ ] Define four Zod-schema'd event payloads — `DRAFT_TURN_STARTED`, `LINEUP_LOCK_WARNING`, `SCORING_SWING`, `PAYOUT_CONFIRMED` — and include them in the Step 1 contract pipeline so they're versioned the same way API schemas are
- [ ] Add a `POST /devices` endpoint (validated, authenticated) to register a push token per user + platform (`ios`/`android`); store in the Phase 1 persistence layer
- [ ] Integrate FCM on the backend as the single delivery pipeline for both platforms (FCM relays to APNs for iOS under the hood — one integration, one retry/delivery-tracking surface, per the stack decision above)
- [ ] Wire `DRAFT_TURN_STARTED` into Phase 1 Step 3's draft engine (emit on every turn change) and into Phase 1's AI moderator nudge scheduler (emit as a secondary nudge approaching timeout) — real state-change emission, not a poll loop watching draft state
- [ ] Wire `LINEUP_LOCK_WARNING` to a scheduled job firing at **config-driven** countdown intervals ahead of each week's lineup lock (e.g., a `lineupLockWarningOffsetsMinutes` config array — not hardcoded 60/15/5)
- [ ] Wire `SCORING_SWING` into Phase 1 Step 2's scoring engine — emit when a live score update moves a user's matchup point differential or win probability past a **configurable** threshold, not an arbitrary inline constant
- [ ] Define and stub `PAYOUT_CONFIRMED` as a ready-to-call emitter function with its Zod schema and delivery path fully wired, awaiting only a real call site once a Phases 3–6 payments engine exists
- [ ] iOS: implement FCM registration, foreground banner handling, background delivery, and deep-linking each notification type to the correct screen (draft room / lineup / matchup / wallet)
- [ ] Android: implement the same FCM registration, notification handling, and deep-linking behavior
- [ ] Implement per-category notification preferences (draft-turn / lineup-lock / scoring-swing / payout independently toggleable), defaulting to on but honoring the "contextual, not blast" principle from strategy doc §4
- [ ] Tests: backend unit tests asserting the correct event + payload fires on each real state change; device-registration endpoint tests; an end-to-end manual/integration test firing each of the three currently-real event types to a live simulator/device

### Verification
```bash
npm test -- notifications
npm run typecheck
# manual: trigger DRAFT_TURN_STARTED, LINEUP_LOCK_WARNING, and SCORING_SWING against a dev backend;
# confirm delivery and correct deep-link behavior on both a physical/simulated iOS device and an Android device/emulator
```

### Exit criteria
- All four event payloads are Zod-validated and versioned in the Step 1 contract pipeline
- `DRAFT_TURN_STARTED`, `LINEUP_LOCK_WARNING`, and `SCORING_SWING` are emitted from real backend state transitions (draft engine, scoring engine, lock-timer scheduler) — verified by test, not by polling
- A registered device receives real end-to-end pushes for all three currently-real event types in a dev environment, with correct deep-linking
- `PAYOUT_CONFIRMED`'s schema, registration path, and delivery pipeline exist and are ready for a single call-site addition once payments land
- Per-category opt-out works and defaults are sane (no blast-style default-on flood)

### Rollback
Additive backend event bus plus mobile notification handlers, gated behind a feature flag; can be disabled without touching the draft engine, scoring engine, or either app's core rendering path.

---

## Step 5 — Platform-native live surfaces

**Model tier:** default (additive native-platform feature work on top of Steps 2–4's existing state and push infrastructure; not architecture-defining)
**Depends on:** Step 2, Step 3 (need the running iOS/Android apps and their SSE-derived state), Step 4 (Android's live surface reuses its foreground-service notification infrastructure; iOS Live Activity updates while backgrounded reuse its push pipeline)
**Parallel with:** Step 6 (no code dependency in either direction)

### Context brief
A UX review found the original Steps 2–4 spec stopped at feature-parity screens and named this surface explicitly as a gap: "iOS Live Activities/Dynamic Island... a near-perfect, Apex-unavailable fit for 'you're on the clock'" — a real, currently-unclaimed differentiator, not a nice-to-have (`docs/research/2026-08-16-ux-review.md` I7; see also `00-roadmap.md`'s "Scaling & UX review" backlog for Phase 7). This step builds the "glanceable" surfaces that live outside the app itself: an active draft turn or a live matchup score, visible without opening the app. iOS gets this natively via ActivityKit (Live Activity + Dynamic Island). Android has no direct equivalent to Dynamic Island, but Step 4 already built a foreground-service + persistent-notification mechanism for an active live-draft session (per Android's background execution limits) — that's the natural foundation for an equally glanceable, always-visible surface here, not a reason to invent a second Android mechanism. Both platforms additionally get home-screen widgets. This step introduces no new backend data source — it renders state Steps 2–4 already fetch or stream (draft-turn state from the shared SSE taxonomy, matchup score from the same source the roster/matchup screens already read).

### Tasks
- [ ] iOS: implement a Live Activity (ActivityKit) for an active draft turn — whose pick it is, the countdown, live updates — presented in the Dynamic Island (compact + expanded presentations) on supported devices
- [ ] iOS: implement a second Live Activity for a live matchup score, updating as the scoring feed changes, with the same Dynamic Island treatment
- [ ] iOS: drive Live Activity updates from the existing SSE-derived state where the app has an active connection, and via ActivityKit push updates through Step 4's FCM/APNs pipeline when the app is fully backgrounded — no second, parallel data-fetch path built just for the Live Activity
- [ ] Android: build the equivalent always-visible surface for an active draft turn on top of Step 4's existing foreground-service + persistent-notification infrastructure — an expandable notification showing the current pick/countdown, updating live
- [ ] Android: extend the same foreground-service notification pattern to a live matchup score during an active game window
- [ ] iOS: build home-screen widgets (WidgetKit) for current matchup score and next lineup-lock time, small and medium sizes at minimum, with a sensible static fallback when neither is relevant (e.g., off-season, no active matchup)
- [ ] Android: build the equivalent home-screen widgets (Glance/AppWidget) for the same two data surfaces as iOS — current matchup score and next lineup-lock time
- [ ] Notification quick-actions on the push types Step 4 already defines, added where they make sense without leaving the notification — e.g., a `LINEUP_LOCK_WARNING` notification gets a "Set optimal lineup" quick-action; `DRAFT_TURN_STARTED` does not get one, since making a correct pick requires the draft room's full player pool
- [ ] Both platforms: define a shared, config-driven refresh-cadence budget for these surfaces, respecting each platform's background-refresh throttling (iOS Live Activities and WidgetKit both rate-limit update frequency by OS design) — don't assume push-perfect real-time fidelity in a surface the OS itself throttles
- [ ] Document each surface's data source and refresh mechanism in `docs/mobile-parity.md` (the same shared file Steps 2 and 3 use), since a Live Activity and Android's foreground-service notification are not visually or mechanically equivalent even though they serve the same user need — this is exactly the kind of intentional, documented platform divergence that file exists for

### Verification
```bash
xcodebuild -scheme FantasyApp -destination 'platform=iOS Simulator,name=iPhone 15' test
./gradlew connectedAndroidTest
# manual: start a mock draft; confirm the Live Activity/Dynamic Island (iOS) and the persistent notification (Android)
# both update live as picks happen without opening the app; confirm home-screen widgets update on both platforms
```

### Exit criteria
- The iOS Live Activity + Dynamic Island correctly reflects an active draft turn and updates without the app in the foreground
- Android's foreground-service notification shows equivalent live draft-turn state built on Step 4's existing infrastructure, not a new mechanism
- Home-screen widgets on both platforms show current matchup score and next lineup-lock time, with a correct fallback state when neither exists
- `docs/mobile-parity.md` documents each surface's platform-specific implementation and why it diverges from its counterpart

### Rollback
Additive native surfaces layered on top of Steps 2–4's existing state and push infrastructure; can be disabled per platform without affecting the core draft room, roster screens, or push delivery.

---

## Step 6 — Developer accounts, store listings, and submission planning (business/logistics prerequisite)

**Model tier:** default (this step is coordination and documentation, not architecture)
**Depends on:** nothing code-related — start this as early as organizationally possible
**Parallel with:** everything else in this phase; has no code dependency in either direction

### Context brief
This is a genuine real-world prerequisite, not a coding task — flagged explicitly the same way earlier phases flagged their own business/legal prerequisites (banking-partner selection, gaming-counsel review). **Neither app can reach the App Store or Google Play without an active Apple Developer Program membership and Google Play Developer account existing first**, under the correct legal entity, and real-money contest apps face additional store-policy scrutiny (Apple App Review Guideline 3.1.1 on real-money gaming; Google Play's Real-Money Games policy) that a normal consumer app never encounters. Kick this off early: Apple's entity verification (D-U-N-S lookup, legal-entity confirmation) alone can take one to two weeks, and this step has zero code dependencies blocking it from starting on day one of this phase.

### Tasks
- [ ] **[Business action, non-code]** Enroll the platform's legal entity in the Apple Developer Program ($99/yr) — confirm/obtain a D-U-N-S number if enrolling as an organization, not an individual
- [ ] **[Business action, non-code]** Enroll the same legal entity in the Google Play Developer Console ($25 one-time registration fee)
- [ ] **[Business action, non-code]** Decide and reserve the iOS bundle identifier and Android package name in both consoles, matching Step 2/3's app configuration
- [ ] Draft a privacy policy covering every category of data actually collected: account/auth data, push tokens, real-time location/geofencing data (strategy doc §2/§5), and — once applicable — KYC/payment data from Phases 3–6; publish it at a stable public URL before any submission
- [ ] Complete Apple's App Privacy "nutrition label" questionnaire and Google Play's Data Safety form — coordinate directly with whichever phase owns KYC/geofencing so these declarations describe what the app *actually* does, not a guess made ahead of that work landing
- [ ] Research and document Apple Guideline 3.1.1 (real-money gaming apps) and Google Play's Real-Money Games policy in full — both typically require proof of applicable state licensing/registration (Phase 2 of the strategy doc's legal matrix) and enforced age-gating/geofencing before they'll approve a real-money app; do not assume a standard consumer-app review path applies
- [ ] Determine the correct age rating on both platforms (commonly 17+/Mature-adjacent for real-money contest apps) and set it accurately, not optimistically
- [ ] Prepare submission assets: app icon set (all required sizes), device screenshots, store description copy, support URL, marketing URL
- [ ] Plan a phased rollout: internal TestFlight / Play Internal Testing track first, then a closed beta, then production — and budget realistic review-cycle time, since real-money/gambling-adjacent categories commonly see extended manual review beyond Apple/Google's typical 1–3 day turnaround
- [ ] Record an explicit go/no-go decision: **production store submission should not happen until the platform's actual compliance posture (Tier 1 state launch, KYC, tax infrastructure from Phases 3–6) is live** — submitting a real-money app for review before that exists risks rejection under exactly the policies researched above

### Verification
```bash
# No automated verification — this is a business/logistics step. Manual checklist:
# - [ ] Apple Developer Program membership active and visible in App Store Connect
# - [ ] Google Play Developer account active and visible in Play Console
# - [ ] Bundle ID / package name reserved in both consoles, matching Step 2/3 app configs
# - [ ] Privacy policy live at a public URL, linked from both consoles
# - [ ] App Privacy / Data Safety declarations completed and reviewed against actual data collection
# - [ ] Documented go/no-go note recorded for production submission timing
```

### Exit criteria
- Both developer accounts are active, under the correct legal entity, with reserved app identifiers matching the codebases in Steps 2–3
- Privacy policy and store data-safety declarations are accurate as of whatever data collection actually exists at time of submission
- A written go/no-go decision exists tying production submission to Phases 3–6's compliance completion, not to this phase's code being merely feature-complete

### Rollback
Not applicable in the code-revert sense — this is account and business setup. If the wrong legal entity is enrolled, that requires an Apple/Google support ticket to correct, not a git revert. Treat this step as requiring careful human review before execution, precisely because it can't be cleanly undone.

---

## Step 7 — Native-specific real-time reliability & performance tuning

**Model tier:** strongest (this step directly addresses the failure mode strategy doc §5 names as the single most damaging one for a real-money product — ESPN's peak-Sunday outage — now in its mobile-specific forms)
**Depends on:** Step 2, Step 3, Step 4 (needs both real apps and the push pipeline in place to test reconnect-then-notify behavior together)
**Parallel with:** nothing — this is an integration/hardening pass across both platforms and the backend they share

### Context brief
Strategy doc §5 calls out ESPN Fantasy's roughly hour-long outage during a 2025 Week 2 1pm-ET kickoff — the exact highest-concurrency live moment — as the single most damaging failure mode a real-money product can have. On mobile, that risk shows up in different, platform-specific forms that Steps 2 and 3's basic backgrounding logic doesn't fully cover: apps losing their SSE connection while backgrounded mid-draft, cellular network handoffs (wifi↔LTE, elevator/tunnel dead zones) dropping a connection mid-pick, and multi-hour live-scoring Sundays draining battery or getting the app OS-killed in the background. **Important asymmetry with the web app:** browsers' native `EventSource` handles reconnect-with-backoff automatically; neither `URLSession` nor OkHttp's streaming client does that for you on native platforms, so the reconnect/backoff logic itself has to be hand-built here, not just tested. This step builds and hardens both native apps against exactly those failure modes.

**Redis HA/persistence note (scaling review I8):** a scaling review found Redis — the shared real-time layer this app's SSE client connects to — has no documented persistence policy, replication/failover plan, or specified degradation behavior if it's briefly unavailable. Owning that infrastructure decision (AOF persistence, replication, a Redis-down load-test scenario) is Phase 2's job, not this phase's. What this phase does own, and states explicitly here so it isn't lost: **if a Redis `XADD` publish fails for an accepted write, the write itself does not fail** — per Phase 1's design, the write is already committed and authoritative in Postgres, and publishing to the stream is best-effort. This step's reconnect/full-refetch fallback (above: resume from the last-acknowledged Redis Streams entry ID, falling back to a full authoritative refetch via the Step 1 REST client when the gap exceeds the stream's retention window) is exactly the mechanism that absorbs a brief Redis outage gracefully from the native client's point of view. No additional native-side work is required for this beyond what's already tasked below — it's a property of the reconnect design this step already builds, not a new task.

### Tasks
- [ ] Implement and explicitly test exponential-backoff reconnect logic for the SSE client on both platforms (this doesn't come for free the way it does in a browser) with a bounded max-retry ceiling and a visible "reconnecting…" UI state — never a silently stale draft board
- [ ] On every reconnect (and every foreground resume), resume from the last-acknowledged Redis Streams entry ID — the server replays what was missed automatically, so this isn't a full-state refetch in the common case. Still fetch full authoritative state via the Step 1 REST client as an explicit fallback for the case where the app was backgrounded long enough for the stream's retention window to have expired (a real scenario on mobile, given app-suspension durations, unlike the always-connected web case)
- [ ] iOS: define and justify any background execution modes actually needed (e.g., background push receipt only); explicitly test app-suspended-mid-draft behavior and confirm foreground resume triggers the same full-resync path as a network reconnect
- [ ] Android: implement the Android-appropriate equivalent, including a foreground service with the required persistent notification for an active live-draft session (per Android's background execution limits), with the same full-resync-on-resume behavior
- [ ] Add a visible network-quality indicator in the draft room (connected / reconnecting / offline) so a user on a degrading cellular connection is never left guessing whether their action registered
- [ ] Add optimistic-UI guardrails for pick submission: a "sending…" state until server confirmation, and an explicit failure/retry affordance on rejection or timeout — never a silent drop
- [ ] Battery/performance profiling: run a simulated multi-hour live-scoring session (frequent SSE score-update events) on both platforms via Instruments (iOS) and the Android Studio Profiler; set and document acceptable battery-drain and memory-growth budgets as **explicit config values**, not informal impressions
- [ ] Chaos/network test: using Xcode's Network Link Conditioner and Android Studio's network throttling, simulate flaky connectivity against a running dev backend during an active mock draft (from Phase 1's seeded test league); confirm zero duplicate or lost picks and no permanently stuck "reconnecting" state
- [ ] Write integration tests (XCUITest/Espresso automation where feasible, a documented manual QA script where not) covering: kill-and-relaunch mid-draft, background-for-5-minutes-then-resume mid-draft, and a wifi-to-cellular handoff mid-draft

### Verification
```bash
xcodebuild -scheme FantasyApp -destination 'platform=iOS Simulator,name=iPhone 15' test
./gradlew connectedAndroidTest
# manual: Network Link Conditioner / Android network throttling chaos test against a live mock draft
# manual: multi-hour battery/memory profiling session against sustained live-scoring updates
```

### Exit criteria
- A killed-and-relaunched app mid-draft always resumes to correct, server-authoritative state within an explicit bounded target (e.g., under 3 seconds on a normal connection — set the real number and record it)
- No duplicate or lost picks occur under simulated network flakiness during a full mock draft on either platform
- Documented, config-driven battery/memory budgets exist for a multi-hour live-scoring session, with actual profiling results recorded against them
- The reconnect/network-quality UI state is always accurate — it never shows "connected" while the client is actually desynced from the server

### Rollback
Hardening layered onto the existing Step 2–4 code paths; can be disabled or reverted per platform independently, without affecting the other platform or the backend.

---

## Post-Phase-7: What Still Blocks Production Release

Shipping this phase's code does not itself authorize a public store release. Two independent gates remain, both already flagged above:

1. **Step 6's go/no-go decision** — production submission waits on Phases 3–6's compliance posture (state licensing, KYC, tax infrastructure) actually being live, per Apple's and Google's real-money-gaming review policies.
2. **Feature parity with the web app's regulated features** — real entry fees, payouts, and AI advisory surfaces from Phases 3–6 need their own mobile UI work (not scoped in this phase) before the native apps are feature-complete, even once they're technically installable via TestFlight/Play Internal Testing.
