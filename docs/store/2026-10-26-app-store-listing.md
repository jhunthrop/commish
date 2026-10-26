# App Store: the Commish listing and declarations, drafted

Lane 228, 2026-10-26. Bundle id `app.trycommish.ios` (`apps/ios/project.yml`), iPhone only (`TARGETED_DEVICE_FAMILY: "1"`), portrait only, iOS 17.4 minimum. Every field below is drafted once so the founder pastes rather than writes. A field marked **FOUNDER** needs an answer only the founder holds. The full list is at the end.

**Blocked on the Apple Developer Program enrolment (pending as of 2026-10-26):** no App Store Connect record, TestFlight build, Sign in with Apple key or APNs key exists until the enrolment completes. Every step below waits on it. The copy does not.

Limits were read from Apple's pages on 2026-10-26 (sources at the foot). Character counts are Unicode code points, keywords in bytes, measured by script.

## 1. App information and product page

| Field | Limit | Drafted value | Source |
| --- | --- | --- | --- |
| Name | 2 to 30 characters | `Commish: Fantasy Football` (25) | `CFBundleDisplayName: Commish` in `project.yml`, plus the category words. The same as the Play name |
| Subtitle | 30 characters | `Your lineup, waivers and draft` (30) | The bar's first screens in season and the draft track (spec §3) |
| Promotional text | 170 characters, editable without review | `Free through the 2026 season. The lineup to start, your best add on waivers and the trades that help both teams, read from your own league each week.` (149) | `FREE_WORDS.season.lead` (`web/src/lib/pass/words.ts`) and `IN_SEASON_TOOLS_LINE`. Change it when the season's free run ends (`account-free-season.json` ends 2027-03-01) |
| Description | 4000 characters, plain text | The Play full description, word for word: `docs/store/2026-10-26-play-listing.md` §1.1 (1,550 characters) | One description for both stores, so the apps' words are one |
| Keywords | 100 bytes, comma-separated, no spaces after commas, each over two characters, no app or company names, no repeat of the name | `lineup,waivers,waiver wire,trades,rankings,start,matchup,draft,mock draft,ADP,PPR,tiers,projections` (99 bytes) | Screen names from spec §3. No platform names: Apple bans other companies' names here |
| Support URL | Required, must lead to contact information | `https://trycommish.app/terms` (the Terms end with "Write to help@trycommish.app") | `terms-words.ts`. See F5 for the address and phone Apple may require |
| Marketing URL | Optional | `https://trycommish.app` | The site |
| Privacy policy URL | Required | `https://trycommish.app/privacy` | `web/src/routes/privacy` |
| Privacy choices URL | Optional | `https://trycommish.app/account/delete` | The delete account page (Lane 233). The policy's section is `https://trycommish.app/privacy#deleting-your-account` |
| Primary category | One | Sports | A fantasy football tool |
| Secondary category | Optional | Reference | Projections, rankings, player pages |
| Copyright | `YYYY Entity`, the symbol is added | `2026 Commish LLC` | The LLC that runs Commish (privacy policy, "Who we are") |
| Version | | `0.1.0` today (`MARKETING_VERSION`). Set `1.0.0` for the first store release | `project.yml` |
| What's New | 4000 characters, not on the first version | Not needed for 1.0 | |
| App previews | Optional, up to 3 per size | None | |

Notes on the copy are the Play file's (§1.1 notes): platforms named only in the description, no provider named, no weekly model, no paid tier, no licence credit in the listing, and the pre-submit check that every bullet matches a screen in the submitted build.

## 2. Screenshots

Required for an iPhone-only app: at least one, at most ten, for "iPhone with Dynamic Island (medium display)". Provide the large size too so App Store Connect never scales a medium shot up. JPEG or PNG, no alpha.

| Display | Required | Size to render (portrait) | Count |
| --- | --- | --- | --- |
| iPhone with Dynamic Island, medium (6.3-inch class) | Yes | 1206 x 2622 (1179 x 2556 also accepted) | 8 |
| iPhone with Dynamic Island, large (6.9-inch class) | Recommended | 1320 x 2868 (1290 x 2796, 1260 x 2736 also accepted) | 8 |
| iPad 13-inch | No | The app is iPhone only | 0 |

The eight shots and captions are the Play file's §1.2, in the same order, so the two listings read as one: the lineup to start, waivers, trades, matchup, rankings, board, mock room, player page. Rendered from fixtures in the dark theme. The iOS snapshot suite records on CI (macos-26, Xcode 26.6), so the store shots come from a simulator at the sizes above, not from the snapshot files.

## 3. Age rating questionnaire

| Section | Question | Answer | Why |
| --- | --- | --- | --- |
| In-app controls | Parental controls | No | |
| In-app controls | Age assurance | No | The Terms set 18 and older. Nothing in the app checks age |
| Capabilities | Unrestricted web access | No | Sign-in opens `ASWebAuthenticationSession` on our sign-in page. The app has no browser |
| Capabilities | User-generated content | No | No broadly distributed content. A shared mock opens by its code only |
| Capabilities | Social media | No | No feed |
| Capabilities | Messaging and chat | No | No chat in `MockRoom` or anywhere |
| Capabilities | Advertising | No | No ads |
| Mature themes | Profanity or crude humor, horror or fear, alcohol, tobacco or drug use or references | None to each | |
| Medical or wellness | Medical or treatment information, health or wellness topics | None to each | An injury status ("ruled out", "questionable") is a roster fact, not medical guidance |
| Sexuality or nudity | All three | None | |
| Violence | All four | None | |
| Chance-based activities | Gambling | No | No real money in the app, and the copy guard's banned list covers that register |
| Chance-based activities | Simulated gambling | None | |
| Chance-based activities | Contests | Infrequent | A mock draft ends in a report that grades the member's picks. Conservative: "Infrequent" still rates 4+ |
| Chance-based activities | Loot boxes | No | |

Computed rating: 4+. The Terms and the privacy policy say Commish is for people 18 and older. **FOUNDER F4**: set Apple's higher-rating override to 18+ to match the Terms, or leave the computed 4+.

## 4. App Privacy

Apple's rule: declare data the app sends off the device and keeps longer than the request takes, including what our own sign-in page collects. Not tracking: no data is linked with other companies' data for advertising and none goes to a data broker.

| Question | Answer |
| --- | --- |
| Do you or your third-party partners collect data from this app? | Yes |
| Is any data used to track you? | No. No tracking, no advertising identifier, no `NSUserTrackingUsageDescription`, no third-party SDK beyond Apple's own OpenAPI and HTTP packages (`apps/ios/Packages/*/Package.swift`) |

### 4.1 Data types

| Category, type | Collected | Linked to the member | Used for tracking | Purposes | Code |
| --- | --- | --- | --- | --- | --- |
| Contact Info, Email Address | Yes | Yes | No | App Functionality | `app.accounts.email`, set at sign-in through WorkOS AuthKit (`api/internal/auth/workos.go`) |
| Contact Info, Name | Yes | Yes | No | App Functionality | `app.accounts.first_name`, `last_name` when the sign-in gives them |
| Identifiers, User ID | Yes | Yes | No | App Functionality | The account id, the handle, the paired device's row (`app.devices`, Keychain-held token) |
| User Content, Other User Content | Yes | Yes | No | App Functionality | Mock drafts and reports, the leagues followed and the team chosen, the lineup moves and waiver claims the member confirms (`app.host_moves`) |
| Diagnostics, Other Diagnostic Data | Yes | No | No | App Functionality | The request log keeps the calling address to keep the service running and safe (privacy policy, "Who handles it for us"). No account id in the API's own log entries (`api/internal/httpx`) |

Not collected: location, contacts, health and fitness, financial info, sensitive info, photos or videos, audio, gameplay content, customer support, browsing history, search history, purchases, product interaction, advertising data, crash data, performance data, device ID, surroundings, body.

Notes:

- No push yet: the entitlements hold `applinks` and `webcredentials` only (`project.yml`), no `aps-environment`. When push lands (spec §5.3) the APNs device token is sent and kept: add Identifiers, Device ID, linked, App Functionality, in that release.
- Platform connections are made on the web, not in the app, so the app does not collect platform cookies or tokens.
- Export compliance: `ITSAppUsesNonExemptEncryption: false` is in `Info.plist` (`project.yml`). The app uses only HTTPS and the Keychain through Apple's OS, which is exempt. App Store Connect then asks no encryption question.

## 5. Review

### 5.1 Sign in with Apple (guideline 4.8)

The app signs in through WorkOS AuthKit's hosted page in `ASWebAuthenticationSession` (`api/internal/auth/workos.go`, provider `authkit`). Guideline 4.8 turns on what that page offers:

- If AuthKit offers only email (a password or an emailed code), Commish uses "your company's own account setup and sign-in systems" and no other login service is required.
- If AuthKit offers Google, or any social sign-in, as a way to set up the account, Apple requires an equivalent option that limits data to name and email, lets the member hide their email and does no ad tracking. Sign in with Apple meets it.

The spec (§5.2) plans Apple beside Google. **FOUNDER F1**: which sign-in methods AuthKit offers in production. If Google is on, enable Apple in the WorkOS dashboard before submission. That needs the Apple Developer enrolment (a Services ID, a Sign in with Apple key and the team id, entered in WorkOS), so it is blocked on the enrolment like the rest. The sign-in sheet needs no app change: AuthKit draws the Apple button.

### 5.2 Account deletion (guideline 5.1.1(v)): done in the app and on the web

"If your app supports account creation, you must also offer account deletion within the app." A new member can create an account from the app's sign-in sheet. Apple accepts an in-app button that starts deletion, or a direct link from the app to a web page where it is completed. An email address alone is rejected outside highly regulated industries.

The route and the web page are done (Lane 233): `POST /me/delete` deletes the account and every row kept with it at once, platform connections first, then the sign-in user, and every device token opens nothing after; `https://trycommish.app/account/delete` does the same on the web, and the policy's section is `https://trycommish.app/privacy#deleting-your-account`. The in-app path is done too (Lane 237): the **Account** screen (the person icon in the top bar) ends with a "Delete account" verb where the old "write to help@trycommish.app" line was. It opens a sheet that lists what is deleted and what is kept, takes the account's email typed by hand, and holds its one verb, "Delete my account", until the email matches. The verb calls `POST /me/delete` with the device token; on success the phone forgets its sign-in and every saved answer, as Sign out does, and lands signed out on the public tabs with "Your account is deleted". A renewing membership is refused with the API's sentence. The app does not send the member to the web page, which would ask them to sign in again (an app's sign-in makes no site session, Lane 225). Play's requirement (Play file §4.3) is met by the same work.

### 5.3 Sign-in information and notes for the reviewer

| Field | Limit | Value |
| --- | --- | --- |
| Sign-in required | | Yes |
| User name, password | Must not expire | **FOUNDER F2** enters them in App Store Connect only, never in this file |
| Contact name, email, phone | Phone with + and country code | The founder's name, `help@trycommish.app`, **FOUNDER F5** phone |
| Notes | 4000 bytes | The text below (981 bytes) |

```text
Commish shows a member's fantasy football league as box scores: the lineup to start, waivers, trades and the matchup, plus a draft board and player pages.

Sign in: tap Sign in. The sign-in page opens in the system sheet. Use the email and password above. The app returns on its own.

The review account follows one public Sleeper league, so the league screens show a real league with no platform sign-in. The board and the player pages work signed out too.

No purchases: everything is free through the 2026 season and the app has no in-app purchase. No ads, no tracking. The Account tab shows notification switches, but this version registers no push token and sends no notification. The switches are saved on the phone only.

A move from the Lineup or Waivers screen goes to the member's own league platform only after the member confirms it. The review account has no platform connection, so no move can be sent from it.

Delete your account: Account, then Delete account at the foot of the screen, then type the account's email and tap Delete my account (also on the web at https://trycommish.app/account/delete).
```

The last sentence is true only once §5.2 ships: remove it if the build lacks it, and do not submit without it.

### 5.4 Content rights

"Does your app contain, show, or access third-party content?" Yes: player names, game schedules and statistics, the week's published projection, player photos, and the member's own league data read from their platform. **FOUNDER F3** answers "I have the necessary rights" only after confirming the licence for the projection feed and for the player photos the app draws (the `headshot` field the API serves). The nflverse and FTN charting figures are CC BY 4.0 and CC BY-SA 4.0, credited on the player page (`web/src/lib/site/credit.ts`).

### 5.5 Other submission answers

| Question | Answer |
| --- | --- |
| Uses the advertising identifier (IDFA) | No |
| Made for kids | No |
| Pricing | Free, no in-app purchases |
| Availability | United States to start. **FOUNDER F7**: other countries. The EU needs a trader declaration under the Digital Services Act that publishes an address, phone and email |
| Phased release | On, for updates |

## 6. Graphics checklist

| Asset | Size | Exists | Where |
| --- | --- | --- | --- |
| App icon | 1024 x 1024 PNG, no alpha | Yes, 1024 x 1024 RGB | `apps/ios/Commish/Assets.xcassets/AppIcon.appiconset/AppIcon.png` |
| Screenshots, medium Dynamic Island | 1206 x 2622, no alpha | **Missing** | Render from fixtures on a simulator, add §2 captions |
| Screenshots, large Dynamic Island | 1320 x 2868, no alpha | **Missing** | As above |
| iPad screenshots | | Not needed | iPhone only |
| App preview | | Not needed | |

## Sources (read 2026-10-26)

- App information (name, subtitle, category, privacy policy URL, content rights): https://developer.apple.com/help/app-store-connect/reference/app-information/app-information
- Platform version information (promotional text, description, keywords, URLs, review notes): https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information
- Screenshot specifications: https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
- Age ratings values and definitions: https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions
- App privacy details: https://developer.apple.com/app-store/app-privacy-details/
- App Review Guidelines (2.1, 4.8, 5.1.1(v)): https://developer.apple.com/app-store/review/guidelines/

## FOUNDER questions

- **F1**: Which sign-in methods does WorkOS AuthKit offer in production (email and password, emailed code, Google, others)? If any social sign-in is on, Sign in with Apple must be enabled in WorkOS once the Apple enrolment completes.
- **F2**: The review account for both stores: an account that signs in with an email and a password (a reviewer cannot read an emailed code), never expires, and follows one public Sleeper league. Is password sign-in on in AuthKit? Create the account, follow the league, and type the credentials into App Store Connect and Play Console only.
- **F3**: Content rights: do the projection feed's terms and the player photos' source allow showing them in a phone app? Answer before ticking "I have the necessary rights".
- **F4**: Apple's age rating computes to 4+. Override to 18+ to match the Terms, or keep 4+?
- **F5**: A phone number for the App Review contact, and whether the support page should carry a postal address (Apple: "as may be required by local law").
- **F7**: Countries: the United States only, or more? The EU requires a public trader declaration (address, phone, email).
