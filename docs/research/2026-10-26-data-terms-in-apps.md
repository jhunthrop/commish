# Data terms in native apps (F3), 2026-10-26

Internal memo. Not legal advice; counsel should confirm the unclear items. The stats provider is named here only because this memo is internal; it never appears in site or store copy.

Question: do the terms of our licensed sources allow showing their data and player photos inside the iOS and Android apps, as on the web?

## What the code uses

- Stats provider: Tank01, bought on RapidAPI. Host `tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com` (`research/pipeline/tank01/client.py`, `TANK01_HOST`); key `TANK01_API_KEY` (`infra/README.md`). The paid plan tier is not recorded in the repo (only "a paid tier is approved", `docs/decisions/live-scoring-pipeline.md`); the listing's tiers are Pro $10/mo, Ultra $25/mo, Mega $100/mo, each "specific to a sports league".
- Player headshots: not from the stats provider. `web/src/lib/ui/headshot-provider.ts` builds `https://a.espncdn.com/i/headshots/{league}/players/full/{id}.png` and `https://a.espncdn.com/combiner/i?img=...&w=...&h=...`. Image host: ESPN's CDN (`a.espncdn.com`), owned by The Walt Disney Company. Our `/img/headshots/[league]` route fetches and edge-caches them, so every face loads from our origin. Club marks use the same host (`/i/teamlogos/...`).
- Also in `provider_players.headshot_url` (a column the boards read); the avatar route (`/img/avatars/[platform]/[id]`) is a separate matter, a member's own fantasy team avatar, not covered here.

## Source 1: Tank01 data (via RapidAPI listing)

Read 2026-10-26: listing details page https://rapidapi.com/tank01/api/tank01-nfl-live-in-game-real-time-statistics-nfl/details and https://www.tank01.com/ (read through a text extractor; the listing's own "Terms" tab is a JavaScript panel that did not render, so any plan-level terms text there was not seen).

- Display in a mobile app: covered in marketing, not in a clause. The listing says the API is "perfect for your fantasy website or mobile app" and "Very Useful for Fantasy Football Apps"; tank01.com says custom endpoints can be built "to suit your app". That is an intended use, not a licence term.
- Redistribution limits: none found on either page. No licence text, no attribution requirement, no ban on caching or storing, no ban on republishing derived data. We store the data in our own database and serve it through our API, which is redistribution in effect, so the absence of a clause is the main risk.
- Attribution: none required on the pages read.
- Separate licence: no clause found requiring one. The provider offers "custom API's for subscribers" and answers at support@tank01.com.
- Gambling data: the same listing sells betting odds and prop bets; our own memo (`docs/research/2026-10-26-fantasypros-dfs-tools.md`) already notes we lack clear rights to display DFS salaries. Odds and salaries should be treated apart from box scores and projections.
- Verdict: unclear, leaning allowed. Nothing read forbids the apps, and the listing invites them. Risk if wrong: the provider or RapidAPI suspends the key (RapidAPI may "suspend or terminate" at its discretion), which stops ingestion for web and apps alike; the exposure is the same as the web's today, since the apps read our API, not the provider. Action: email support@tank01.com once, asking in writing that (a) display in iOS and Android apps, (b) storing and republishing the data and the weekly projection, and (c) the plan tier we hold are covered; keep the reply. Send it before store submission.

## Source 2: RapidAPI Terms of Service

Read 2026-10-26: https://rapidapi.com/terms (page footer "Last Updated: May 13, 2026"; operated by Nokia of America Corporation, dba Rapid).

- Display in a mobile app: not addressed. The terms say the rights to use each API are "solely between each such API Consumer and such API Provider, and not with Rapid" (section "API Rights"). So RapidAPI adds no licence of its own, and everything turns on the provider's listing terms (Source 1).
- Redistribution limits: the Restrictions list bars reselling, distributing or sublicensing "the Service (or any components thereof)". The Service is the marketplace, not an API's data; the text does not speak to API content. Reading it as covering API data would be a stretch, but a provider could say so in its own terms.
- Attribution: none required. Rapid trademarks may not be used without consent (Trademarks), so store copy should not use the RapidAPI name or logo.
- Separate licence: none required by Rapid. It may "implement rate limits or sandboxing" and suspend an API or an account at its sole discretion (Suspension or Termination).
- Verdict: allowed (it neither grants nor restricts; it defers to the provider). Risk: low; the platform can suspend access on its own call, which is the same risk the web already carries.

## Source 3: Player photos on the ESPN CDN (Disney)

Read 2026-10-26: Disney Terms of Use, https://disneytermsofuse.com/english/ ("Last Updated: May 24, 2024"). This is the only terms document tied to the `espncdn.com` host that we found. We found no developer licence, public image API terms, or image-hosting terms for `a.espncdn.com`; the CDN's headshot and combiner paths are not a documented public API.

- Display in a mobile app: the licence in section 2 is "limited, non-exclusive, non-sublicensable, non-transferable" for "personal, noncommercial use only", with "no right to reproduce, distribute, communicate to the public, make available to the public, or transform" any product. That does not give us, a commercial publisher, a right to display or re-serve the images in any surface, web or app. Section 3.B mentions use on iOS and Android devices only to say Apple and Google terms also apply to Disney's own products. Nothing permits third-party apps.
- Redistribution limits: section 2.B bars accessing or extracting Disney Products "using a robot, spider, script, or other automated means" and any "commercial or business-related use"; 3.H refuses uses "in marketing or branding". Our route fetches the images by script and caches them at the edge for a week, which is the pattern this clause describes.
- Attribution: none offered, because no licence for our use is offered.
- Separate licence: yes. Player images carry rights of the league, the clubs and, for likeness, the players (NFL Players Association group licensing). Using them commercially in a store listing, in screenshots, or in app UI needs a licence from the rights holder, or a photo vendor that supplies licensed headshots.
- Verdict: not allowed as written, on the web too. This is a finding for the web, not only the apps. Risk: a takedown or a store rejection (App Store guideline 5.2 on third-party intellectual property; Google Play's intellectual property policy), a rights-holder demand, or the CDN blocking our fetches. Store review is more likely to look at screenshots than at code, so the headshots in store screenshots are the exposure to remove first.

## Verdicts

- Tank01 stats data via RapidAPI listing: unclear, leaning allowed; nothing forbids apps, the listing invites them, get written confirmation by email.
- RapidAPI Terms of Service: allowed (defers to the provider; no restriction on API data found).
- Player photos on ESPN's CDN: not allowed as written (Disney Terms of Use: personal, noncommercial licence; no scripted extraction); needs a licensed source.

## Recommended next steps (decisions for the founder)

1. Email Tank01 for written confirmation of app display and storage (free, a day).
2. Treat the ESPN headshots as a legal problem now, before the apps ship: ask counsel, then either license headshots (a sports-photo vendor) or ship initials and club-colour marks,. Keep headshots out of store screenshots until then.
3. Keep every store listing free of provider names and of the RapidAPI name.

## Limits of this read

- The RapidAPI listing's Terms tab and any pricing-plan legal text did not render; only the marketing description was read.
- Disney's page was read through a text extractor that summarizes; clause wording above is from that extract, not a legal reading of the full document.
