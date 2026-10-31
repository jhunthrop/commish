# Google Play: the Commish listing and declarations, drafted

Lane 228, 2026-10-26. App id 4975392000492866153, package `app.trycommish.android`, Play organization account 8822898797320746402. The first bundle is on the internal track (CI run 40254247245). Every field below is drafted once so the founder pastes rather than writes. A field marked **FOUNDER** needs an answer only the founder holds. The full list is at the end.

The founder has no Android device (iPhone only): every Play step here is a console step or an emulator check on the Mac, never "the build on your phone".

Limits were read from Google's help pages on 2026-10-26 (sources at the foot). Character counts are Unicode code points, measured by script.

## 1. Main store listing

| Field | Limit | Drafted value | Source |
| --- | --- | --- | --- |
| App name | 30 characters | `Commish: Fantasy Football` (25) | The app's name (`apps/android/app/src/main/res/values/strings.xml` `app_name`) plus the category words a search reads |
| Short description | 80 characters | `The lineup to start, your best waiver add and the trades that help both teams.` (78) | The site's in-season sentence, `IN_SEASON_TOOLS_LINE` in `web/src/lib/league/hosts.ts` |
| Full description | 4000 characters | The text in §1.1 (1,644 characters) | The free page's entries (`web/src/lib/pass/words.ts`), the page descriptions (`web/src/lib/site/head-words.ts`), the platform order (`LEAGUE_HOSTS`) |
| App icon | 512 x 512, 32-bit PNG with alpha, at most 1024 KB | `docs/store/play-graphics/icon-512.png`: `web/static/icons/icon-512.png` re-saved as RGBA (Lane 255) | The web's icon, the same whistle as the app's launcher (`ic_launcher_foreground.xml`) |
| Feature graphic | 1024 x 500, JPEG or 24-bit PNG, no alpha | `docs/store/play-graphics/feature-graphic.png` (Lane 255) | Required to publish |
| Phone screenshots | 2 to 8. JPEG or 24-bit PNG, no alpha. Each side 320 to 3840 px, long side at most twice the short | 8 portrait at 1080 x 1920 (9:16), captions in §1.2: `docs/store/play-graphics/phone-1-lineup.png` to `phone-8-player-page.png` (Lane 255) | 4 or more at 1080 px or wider make the app eligible for promotion |
| 7-inch tablet screenshots | Optional. If given, at least 4, each side 1,080 to 7,680 px, 16:9 or 9:16 | None | The spec §2: tablets are not a distinct layout in release one |
| 10-inch tablet screenshots | Same as 7-inch | None | As above |
| Preview video | Optional, one YouTube URL | None | Not in release one |
| Category | One app category | `Sports` | Google's own example for Sports names "fantasy team management" |
| Tags | At most 5, from the console's list | Proposed: Fantasy sports, Football, Sports stats, Sports news, Sports. Pick the closest five the console offers | The console holds the list. This lane could not read it signed out |
| Contact email | Required | `help@trycommish.app` | `web/src/lib/legal/contact.ts` `SUPPORT_EMAIL`, the footer address |
| Website | Optional, recommended | `https://trycommish.app` | `PUBLIC_BASE_URL` in `.github/workflows/api.yml` |
| Phone | Optional | `(479) 227-2208` | The public number (F5, resolved 2026-10-26). The founder's private number goes to Apple's App Review contact only |
| Privacy policy URL | Required | `https://trycommish.app/privacy` | `web/src/routes/privacy`, words in `web/src/lib/legal/privacy-words.ts` |

### 1.1 Full description

The same text serves the App Store description. Plain text, bullets as the character "•", no markup.

```text
Commish reads your fantasy football league and lays out each week as a box score: the lineup to start, your best add on waivers and the trades that help both teams. Every number names its basis.

IN SEASON
• Lineup: the lineup to start, with each player's game this week.
• Matchup: your game, kept up to date on Sunday.
• Waivers: the players nobody in your league holds, with your best add first.
• Trades: the trades that help both teams, from your own roster.
• Rankings: every QB, RB, WR and TE in our rest-of-season order, with this week's kickers and defenses and the week's published projection.
• Record: how our board and our order have done, graded week by week.

DRAFT
• The board in every format, with tiers and the drop to the next one.
• Every player: his projection, its basis, and the writing on him.
• ADP: where drafters take each player. Compare two players, the clubs and the schedule.
• Mock drafts against bots on your league's settings, with our call at every pick and the report on your picks.
• Live draft: follow your real draft on Sleeper and get our call at each of your picks.

YOUR LEAGUES
Follow your leagues on Sleeper, MyFantasyLeague, FFPC, Yahoo and ESPN. Your league's exact scoring drives the board, your mock drafts and every in-season screen. A move you make from Commish goes to your platform only after you confirm it.

FREE THIS SEASON
Every tool on Commish is free through the 2026 season, for every account. Nothing to pay and no card to give.

No ads and no analytics. Commish is for people 18 and older.

Commish is not affiliated with or endorsed by Sleeper, MyFantasyLeague, FFPC, Yahoo or ESPN.
```

Notes on the copy:

- The platforms are named because a member must know whether their league can be followed. The names and order are the site's (`LEAGUE_HOSTS`: Sleeper, MyFantasyLeague, FFPC, Yahoo, ESPN). Sleeper and MyFantasyLeague have no switch. The other three switches (`HOST_FFPC_ENABLED`, `HOST_YAHOO_ENABLED`, `HOST_ESPN_ENABLED` in `api.yml`) default on in production. If one is off on the day of submission, drop that name. The live draft names Sleeper alone because only Sleeper's live draft is read (`PLATFORMS` in `hosts.ts`).
- No projection provider is named. "The week's published projection" is the site's own phrase (`freeSeasonLines`).
- No weekly model is claimed: the order is the rest-of-season order, graded week by week (the founder's rule after rounds 2 to 4).
- No paid tier is mentioned. The free page's "Paid tiers come later" sentence is left out on purpose (a store listing promises nothing about later).
- No licence credit: no nflverse or FTN figures appear in the listing. The credit stays on the player page where the charted figures are.
- Pre-submit check: every bullet must match a screen in the submitted bundle. Drop "Live draft" or "Mock drafts" if the companion or mock room is not in that build, and add "Your cheat sheet" only when the sheet ships in the app.

### 1.2 Screenshot captions (phone, in order)

| # | Screen | Caption |
| --- | --- | --- |
| 1 | Start (the lineup) | The lineup to start, every week |
| 2 | Waivers | Your best add on waivers |
| 3 | Trades | Trades that help both teams |
| 4 | Matchup | Your game, kept up to date |
| 5 | Rankings | Our rest-of-season order |
| 6 | Board | The board in every format |
| 7 | Mock room | Our call at every pick |
| 8 | Player page | Every number with its basis |

Captions sit above the screen on a plain tokens background (`shared/design/tokens.json`), dark theme, one caption per shot. The screens are drawn from a fixture league (`shared/fixtures`) so no member's data appears.

## 2. App content: declarations

| Declaration | Answer | Source |
| --- | --- | --- |
| Privacy policy | `https://trycommish.app/privacy` | As §1 |
| Ads | No, the app contains no ads | No ad SDK in `apps/android/gradle/libs.versions.toml`. The privacy policy: "We run no analytics and no ad scripts" |
| App access | Some functionality is restricted: the league screens need a signed-in account. Instructions in §2.1 | The shell draws the signed-out bar (`RootTabs.kt` `ShellState.SignedOut`). The league screens need a device token |
| Content rating | Questionnaire answers in §3 | |
| Target audience and content | 18 and over only. Not designed for children. The store listing does not appeal to children | The privacy policy's Age section: "Commish is for people 18 and older" |
| News app | Not a news app. Commish publishes no news articles: it shows projections, rankings and a member's own league. The category is Sports, not News and Magazines | The screen inventory, spec §3 |
| Health app | Not a health app. No health, fitness or medical feature or data | The manifest asks for `INTERNET` only |
| Government app | No | Commish LLC is a private company |
| Financial features | "My app doesn't provide any financial features" | No billing in the app (spec §2, the 2026 season is free). Stripe stays in test mode (`STRIPE_ENVIRONMENT` default `test`) |
| COVID-19 contact tracing and status | Not applicable | |
| Data safety | Answers in §4 | |
| Account deletion URL | `https://trycommish.app/account/delete` | The web page (Lane 233): what is deleted and kept, the email typed to confirm, one verb. The policy's section is `https://trycommish.app/privacy#deleting-your-account`. In the app: Account, then Delete account (Lane 237), see §4.3 |

### 2.1 App access instructions for review

Paste into App content, App access, "All or some functionality is restricted", one instruction set:

- Name: `Review account`
- Username and password: `help+review@trycommish.app` with password sign-in, created 2026-10-26 (F2, resolved). The password is in the local env file, pasted into the console only, never in this file. The account follows one public Sleeper league after its first sign-in.
- Other information, drafted:

```text
Open the app and tap Sign in. Sign in with the email and password above in the browser sheet that opens. The app returns on its own. The account follows one public Sleeper league, so the League, Lineup, Matchup, Waivers and Trades tabs show a real league with no platform sign-in. The board and the player pages work signed out too. No move is sent to the league platform unless you confirm it, and this account has no platform connection that could send one. The Account tab shows notification switches, but this version registers no push token and sends no notification. The switches are saved on the phone only.
```

Draft checked against the banned list (§7 of the report). The verb is the app's ("Sign in", `SignIn.kt`). Confirm the tab names on the submitted build before pasting.

## 3. Content rating questionnaire (IARC)

| Question | Answer | Why |
| --- | --- | --- |
| Email for the rating certificate | `help@trycommish.app` | The contact address |
| Category | Reference, News, or Educational | Projections, rankings and a member's own league. Not a game, not a social network |
| Violence, fear, sexuality, language, controlled substances, crude humor | No to each | Player names, numbers and the writing on players only |
| Gambling or simulated gambling, or references to it | No | No money moves in the app and the copy guard's banned list covers that register (`shared/words/banned-words.json`) |
| Users can interact or exchange content | Yes | A shared mock draft opens by its code and shows who shared it. A lobby (spec §3, later release) puts people in one draft. No chat anywhere (no chat in `feature/mock` or `MockRoom`) |
| Shares the user's location with other users | No | No location permission in the manifest |
| Allows purchases of digital goods | No | No billing in the app |
| Unrestricted internet access | No | Sign-in and the follow page open in the system browser (Custom Tabs, `androidx.browser`), not an in-app browser |
| Contains a web browser or search engine | No | As above |

Expected outcome: the lowest rating in each region, with the "Users Interact" notice. The age rating is 18+ on both stores (F4, resolved 2026-10-26): Play computes its rating from these answers, so on Play the 18+ is the target audience (§2), which stays 18 and over whatever the rating says.

## 4. Data safety

Google's rule: "collect" is data the app sends off the device. Data sent to a service provider acting for us (WorkOS for sign-in, Google Cloud for the API and database, Cloudflare for the site) is not "shared". A move the member confirms and sends to their own platform is a user-initiated transfer, also not "shared".

### 4.1 Overview answers

| Question | Answer | Source |
| --- | --- | --- |
| Does the app collect or share any of the required user data types? | Yes, it collects. It shares none | §4.2 |
| Is all user data collected by the app encrypted in transit? | Yes | Release builds call `https://api.trycommish.app`. `network_security_config.xml` sets `cleartextTrafficPermitted="false"`. The room socket is `wss://room.trycommish.app` |
| Do you provide a way for users to request that their data is deleted? | Yes: on the web at `https://trycommish.app/account/delete`, and in the app on the Account screen's Delete account (§4.3); writing to `help@trycommish.app` still works | `POST /me/delete` (`api/internal/deletion`, Lane 233) deletes the account and every row kept with it at once. Kept: lobby draft seats and picks under "Former member", a group pass for its claimants. Policy: `privacy-words.ts`, `#deleting-your-account` |

### 4.2 Data types

Every type not listed is "not collected": location, financial info, health and fitness, messages, photos and videos, audio, files and docs, calendar, contacts, web browsing, installed apps, in-app search history, crash logs, advertising ID.

| Category, type | Collected | Shared | Ephemeral | Required or optional | Purposes | Code |
| --- | --- | --- | --- | --- | --- | --- |
| Personal info, Email address | Yes | No | No | Required | App functionality, Account management | `app.accounts.email` (`api/migrations/00001_accounts.sql`), set at sign-in by WorkOS AuthKit (`api/internal/auth/workos.go`) |
| Personal info, Name | Yes | No | No | Optional | App functionality, Account management | `first_name`, `last_name` nullable in `app.accounts`. Filled only when the sign-in gives one |
| Personal info, User IDs | Yes | No | No | Required | App functionality, Account management | The account id, the handle (`app.accounts.handle`), and the paired device's row (`app.devices`: name, kind, scopes, last used. `00016`, `00031`) |
| App activity, Other user-generated content | Yes | No | No | Optional | App functionality | Mock drafts and their reports (`/mocks/{id}`, the room socket `/rooms/r/ws`), the leagues followed and the team chosen (`/leagues/attached`) |
| App activity, Other actions | Yes | No | No | Optional | App functionality | Lineup moves and waiver claims the member confirms, kept as a record with the platform's answer (`/leagues/attached/{id}/moves`, `app.host_moves`) |
| App info and performance, Diagnostics | Yes | No | No | Required | App functionality, Fraud prevention, security, and compliance | The request log keeps the calling address (privacy policy: "Our servers log each request, with the address it came from"). Not used for location |

Notes:

- Device or other IDs: not collected today. The device token is minted by the server and stored as a hash, it is not a device identifier. When push lands (spec §5.3, `PUT /devices/{id}/push`), the FCM registration token is collected: add "Device or other IDs", App functionality, before that release.
- League data the member follows (rosters, league-mates' team names) is read by the API from the platform, not sent by the app, so it is not a type the app collects. It is covered by the user-generated content row because the member chooses the league.
- Platform connections (ESPN cookies, Yahoo tokens, FFPC sign-in) are made on the web, not in the app (the app opens `/league/new` in the browser, `PlayerSheet.kt` `LEAGUE_START`), so the app does not collect them. If the app ever connects a platform itself, revisit this form.
- Sign-in runs in Custom Tabs on AuthKit's pages, which we control, so the email and name it collects are declared above.

### 4.3 Account deletion: done in the app and on the web

Play requires both an in-app path (or an in-app link to the web resource) and a web resource where deletion can be requested without the app.

1. **On the web: done (Lane 233).** `https://trycommish.app/account/delete` names Commish, lists what is deleted and what is kept, takes the email typed to confirm and deletes at once through `POST /me/delete`; the page after says "Your account is deleted" at the same address. The account page opens it with "Delete account". The policy's section has its anchor, `https://trycommish.app/privacy#deleting-your-account`, and names the page.
2. **In the app: done (Lane 237).** The **Account** screen (the person icon in the top bar) ends with a "Delete account" verb where the old "write to help@trycommish.app" line was. It opens a dialog that lists what is deleted and what is kept, takes the account's email typed by hand, and holds its one verb, "Delete my account", until the email matches. The verb calls `POST /me/delete` with the device token; on success the phone forgets its sign-in and every saved answer, as Sign out does, and lands signed out with "Your account is deleted". The app does not send the member to the web page: an app's sign-in makes no site session (Lane 225), so the page would ask them to sign in again.

## 5. Release tracks and the founder's device

- Internal track: live (first CI upload 2026-10-26, run 40254247245). The organization account is exempt from the 20-tester closed-test rule.
- Production: needs §1 to §4 complete; the feature graphic, screenshots and icon are drawn (§6, Lane 255) and §4.3 is closed (Lane 237).
- Countries: the United States only (F7, resolved 2026-10-26). No EU trader declaration.
- The organization address on the listing stays as the payments profile shows it (F6, resolved 2026-10-26).
- The founder checks the listing and the app on the Mac's emulator (a Play Store AVD signed into his Google account for the internal track), never on a phone.

## 6. Graphics checklist

| Asset | Size | Exists | Where |
| --- | --- | --- | --- |
| App icon | 512 x 512 PNG, 32-bit with alpha | Yes (Lane 255): the web's icon re-saved with an alpha channel | `docs/store/play-graphics/icon-512.png` |
| Launcher icon | Adaptive vector | Yes | `apps/android/app/src/main/res/drawable/ic_launcher_foreground.xml`, `mipmap-anydpi-v26/ic_launcher.xml` |
| Feature graphic | 1024 x 500, JPEG or 24-bit PNG, no alpha | Yes (Lane 255) | `docs/store/play-graphics/feature-graphic.png`: the whistle and "Commish" on the dark page colour, drawn by the app's `Mark` |
| Phone screenshots | 8 at 1080 x 1920, no alpha | Yes (Lane 255) | `docs/store/play-graphics/phone-*.png`: the app's own screens over the fixtures (the league's names replaced), the §1.2 captions drawn above, 24-bit RGB. Redraw with `node apps/android/scripts/store-graphics.ts`; the folder's README lists each file |
| Tablet screenshots | 4 or more at 1,080 to 7,680 px | Not needed | No tablet layout in release one |
| Preview video | YouTube URL | Not needed | |

## Sources (read 2026-10-26)

- Add preview assets to showcase your app: https://support.google.com/googleplay/android-developer/answer/9866151
- Create and set up your app (store listing limits, contact details): https://support.google.com/googleplay/android-developer/answer/9859152
- Choose a category and tags: https://support.google.com/googleplay/android-developer/answer/9859673
- Provide information for Google Play's Data safety section: https://support.google.com/googleplay/android-developer/answer/10787469
- Understanding Google Play's app account deletion requirements: https://support.google.com/googleplay/android-developer/answer/13327111

## FOUNDER questions for Play (resolved 2026-10-26)

- **F2** (shared with the App Store): the review account is `help+review@trycommish.app` with password sign-in; the credentials are in the local env file, pasted into the console only. §2.1.
- **F4** (shared): age rating 18+ on both stores; Play's target audience stays 18 and over. §2, §3.
- **F5** (shared): the listing's phone is the public number, (479) 227-2208. §1.
- **F6**: Play keeps the organization address as the payments profile shows it.
- **F7** (shared): the United States only, no EU trader declaration.
