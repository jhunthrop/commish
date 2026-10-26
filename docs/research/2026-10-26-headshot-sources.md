# Player headshots in the native apps: sources, cost and store review, 2026-10-26

Internal memo. Not legal advice; the two counsel questions are marked. The stats provider is named here only because this memo is internal; it never appears in site or store copy.

Question from the founder: the lowest-cost source of NFL player headshots for the iOS and Android apps that will pass App Store and Google Play review. Background: `docs/research/2026-10-26-data-terms-in-apps.md` (the F3 memo) found the ESPN CDN images we use today are licensed by Disney for "personal, noncommercial use only". The founder has ruled the web keeps its photos regardless; this memo is about the apps only.

## What the code does today

- Web: `web/src/lib/ui/headshot-provider.ts` builds `https://a.espncdn.com/i/headshots/nfl/players/full/{id}.png` (600 x 436 PNG, checked 2026-10-26) and the `combiner` resize URL; club marks for defenses come from the same host (`/i/teamlogos/nfl/500/{club}.png`, `web/src/lib/ui/club-mark.ts`).
- Stats provider image field: Tank01's player list carries `espnHeadshot` (`research/pipeline/tank01/mapping.py`, `map_player_list`), which we copy into `provider_players.headshot_url`. It is an ESPN CDN URL, so the provider's "image field" is a pointer to Disney's images, not a licence. The RapidAPI listing says nothing about images (read 2026-10-26).
- iOS: `apps/ios/Packages/CommishDesign/Sources/CommishDesign/Headshot.swift` already draws the player's initials (`Avatar`) while the image loads, when it fails and when the URL is nil. The web has the same (`web/src/lib/ui/initials.ts`). So the no-photo fallback already exists in both clients; turning faces off in the apps is passing a nil URL.

## What store review actually requires

Apple App Review Guidelines, https://developer.apple.com/app-store/review/guidelines/ (page "Last Updated: October 16, 2026", read 2026-10-26):

- 5.2 preamble: "Make sure your app only includes content that you created or that you have a license to use. Your app may be removed if you've stepped over the line and used content without permission."
- 5.2.1 Generally: "Don't use protected third-party material such as trademarks, copyrighted works, or patented ideas in your app without permission ... Apps should be submitted by the person or legal entity that owns or has licensed the intellectual property and other relevant rights."
- 5.2.2 Third-Party Sites/Services: "If your app uses, accesses, monetizes access to, or displays content from a third-party service, ensure that you are specifically permitted to do so under the service's terms of use. Authorization must be provided upon request."
- 4.1(c): "You cannot use another developer's icon, brand, or product name in your app's icon or name, without approval from the developer."

Google Play, Intellectual Property, https://support.google.com/googleplay/android-developer/answer/9888072 (read 2026-10-26):

- "We don't allow apps or developer accounts that infringe on the intellectual property rights of others."
- Unauthorized use of copyrighted content: "We don't allow apps that infringe copyright." "Developers may be required to provide evidence of their rights to use copyrighted content."
- Its list of common violations names, word for word: "College and professional sports team logos." and "Professional images of public figures."
- "We will respond to clear notices of alleged copyright infringement."; trademark owners are told to contact the developer first, then file a complaint.

Google Play, Impersonation, https://support.google.com/googleplay/android-developer/answer/9888374 (read through search extract 2026-10-26): "Don't imply that your app is related to or authorized by someone that it isn't. Be careful not to use app icons, descriptions, titles, or in-app elements that could mislead users about your app's relationship to someone else." Examples include copying a business's logo "to falsely suggest it is an official app".

How it plays out in practice (judgement from the policy text and public rejection reports, not a published statistic):

- A reviewer cannot tell a licensed headshot from an unlicensed one by looking, and neither store asks for photo provenance by default. Both say proof is required "upon request".
- What draws a review-time rejection is what the reviewer can recognise: team logos, the NFL shield, team or league names in the app name, icon or screenshots. The closest public case (Apple Developer Forums thread 120531) is a free football fantasy app rejected under 4.1 because it "includes content that resembles one or multiple third-party sport teams and/or leagues", for club crests. Google lists pro team logos as an IP violation by name.
- Player faces are mostly a complaint-driven risk: a rights holder (Disney for ESPN's images, a photo agency such as Getty or Imagn, or the NFL Players Association for likeness) files through Apple's dispute form or Google's copyright form, the store asks us for authorization, and without a document the app or update is pulled. Photo agencies run automated image matching and send demand letters; that risk exists on the web today regardless of the stores.
- So: faces in the binary are low review risk and high rights-holder risk unless licensed; logos are high review risk on both stores; store screenshots are the surface reviewers look at hardest.

Two more layers sit behind any photo, licensed or not:

- The photographer's copyright (what the vendors below license).
- The player's publicity right. The standard NFL player contract assigns group licensing to the NFLPA for programs using "six (6) or more NFL player images" in products including "fantasy games" and "internet sites" (as quoted in secondary sources: NFL Players Inc., https://nflpa.com/partners/players-inc; sports-law paper https://www.sportslaw.org/docs/You_Can_Have_Your_Game_Heisserer.pdf). Names and stats in fantasy are protected (C.B.C. v. MLBAM; CBS Interactive v. NFLPA), photos are less settled. Vendors sell their headshots as "licensed for editorial use", which does not clear publicity rights for commercial use. Counsel question 1: does showing licensed editorial headshots beside stats in a free (later paid) fantasy app need an NFL Players Inc. (OneTeam) group licence?

## Sources

Coverage target: about 1,700 players on 53-man rosters plus about 500 on practice squads; fantasy-relevant about 600.

1. **SportsDataIO NFL Headshots.** https://sportsdata.io/developers/sports-player-headshots-api (read 2026-10-26). Converted action shots "via our partnership with IMAGN" (USA Today), plus "official" studio headshots "provided via licensed third parties" with transparent backgrounds. Licence for apps: sold as licensed; the search extract of their pages says "Fully licensed for editorial use"; app terms are in the contract, not on the page. Coverage: all active NFL players; rookies processed from OTAs and minicamps (April to June), refreshed in preseason. Size: 1200 x 1200 at 300 ppi per their marketing extract, with or without background. Integration: an NFL headshots endpoint keyed by SportsDataIO PlayerID with hosted image URLs; "contact our sales team at sales@sportsdata.io for access". Cost: quote required. Public signals: their self-serve Discovery Lab is $599 to $899 a year but aimed at hobby use with next-day data; commercial plans are estimated by third parties at $500 to $1,000+ a month. Estimate for a headshots-only licence: $2,000 to $10,000 a year, possibly conditional on a data plan. We need an id map (name, club and position matching, or a cross-id if the stats provider carries one).
2. **Sportradar Images API.** https://developer.sportradar.com/images-and-editorials/reference/images-overview and /images-faqs (read 2026-10-26). Over 100 collections from AP, Getty, Reuters and Imagn ("usat"), NFL headshots by provider (`ap` or `usat`), manifests per league and season keyed by Sportradar ids, sizes from 205 x 205 crops to originals, premium transparent headshots. Licence: media use; "prohibited for betting clients"; separate licences per sport and per image type; each image carries the agency's copyright field. Integration: manifest pull then store ("save each image on your end"). Cost: quote required, enterprise contracts; estimate $10,000 to $30,000+ a year. Heaviest id mapping (Sportradar ids).
3. **Stats Perform / Opta.** https://www.statsperform.com/faqs/stats-perform-faqs-apis-data-delivery/ lists "headshots" among its APIs; pricing "tailored to ... enterprise-level clients", quote required. NFL headshot coverage not confirmed publicly. The Opta Graphics addendum puts image rights on the licensee and routes Getty images through the licensee's own Getty subscription, so it is not a cheap path. Estimate: enterprise, $20,000+ a year.
4. **Getty Images editorial.** https://www.gettyimages.com/eula and plans pages (read through search extract 2026-10-26). Editorial content may not be used for "any commercial, promotional, advertorial, endorsement, advertising, gambling/betting/gaming uses, or merchandising purpose" without written authorization, and "you are responsible for obtaining any necessary approvals from third parties such as individuals featured". Sports content also follows league credential restrictions. Self-serve Editorial subscription: $167 a month on an annual plan for 10 downloads a month (about $2,000 a year for 120 images), far short of 1,700 players; full coverage needs an enterprise quote. No player-id mapping; we would crop and key every image ourselves. Not a fit.
5. **AP Images.** AP Newsroom (https://newsroom.ap.org); metered subscriptions with five price tiers, quote required. No headshot product keyed by player id on its own; AP's NFL headshots are the `ap` collection resold through Sportradar. Estimate: comparable to Sportradar once cropping and mapping are counted.
6. **Imagn (USA Today) direct.** https://imagn.com/licenseAgreement: "licensed for one time editorial use", "not for resale, trade, packaging, promotion nor advertising", credit line required. Subscriptions exist (three tiers, unlimited editorial downloads), prices not published. No id-keyed headshot feed direct; SportsDataIO is the packaged form of the same pictures. Quote required; estimate a few thousand a year plus our own cropping and mapping work.
7. **Stats provider's own image field (Tank01 `espnHeadshot`).** ESPN CDN URLs; the provider cannot sublicense Disney's images and its listing claims no image rights. Same verdict as ESPN. Cost $0, risk high.
8. **ESPN CDN (today's web source).** Disney Terms of Use: personal, noncommercial; no scripted extraction (F3 memo). 600 x 436 PNG by ESPN id. Cost $0, review risk medium (not visible to a reviewer), rights-holder risk high.
9. **Sleeper CDN.** `https://sleepercdn.com/content/nfl/players/{sleeper_id}.jpg` serves (checked 2026-10-26: 200, JPEG 350 x 254, Cloudflare in front of S3) but is undocumented. Sleeper's API docs, https://docs.sleeper.com/ (read 2026-10-26): the API is "free to use for non-commercial purposes" and "For commercial use of the Sleeper API, please reach out to us directly ... to discuss licensing"; the docs document only user and league avatars, no player images. Sleeper Terms of Use, https://support.sleeper.com/en/articles/5486620-terms-of-use ("Last updated: October 6, 2026"), section 9.2: a licence "for your personal and non-commercial use", and you must not "redistribute, sublicense, copy" the Services; 9.3: marks belong "to us or our licensors". Sleeper almost certainly licenses these photos from an agency and cannot pass that on. Risk high.
10. **NFL.com static CDN and nflverse `headshot_url`.** nflverse's roster files point at NFL's image CDN. NFL.com Terms, https://www.nfl.com/legal/terms/: use "solely for your own individual non-commercial and informational purposes"; "Systematic retrieval of data or other content ... to create or compile ... a collection, compilation, database, or directory, is prohibited". The NFL is the party most likely to notice. Risk high.
11. **Team sites.** Club sites run on the NFL's platform and terms; same verdict as NFL.com, with 32 sources to scrape. Risk high.
12. **"Free for commercial use" routes.** Wikimedia Commons: some players have CC BY-SA or public-domain photos, but coverage of active players is partial (well under half of rostered players, many years out of date, inconsistent framing), CC BY-SA needs per-image attribution, and Commons itself warns that personality rights are separate. The NFLPA (NFL Players Inc., deals run through OneTeam Partners) licenses likeness, not photographs; a public royalty database shows NFLPA licences at 7.5% to 10% of sales, with minimum guarantees usual; quote required, and we would still need photos from a vendor. No free, licensed, full-coverage source exists.

## No-photo fallbacks

- **Initials medallion in club colour.** Already built (iOS `Headshot`/`Avatar`, web `initials.ts`); the only addition is a 32-row table of club colours (colours and a three-letter club abbreviation are facts used nominatively, not a logo). Cost: $0 and under a day. Review risk low, rights risk low. Keeps "someone on every row".
- **Club mark instead of a face.** Not the low-risk option it sounds like: Google lists "College and professional sports team logos" as a violation by name, Apple has rejected a fantasy app under 4.1 for club crests, and our marks come from the same ESPN CDN. If a club cue is wanted, draw the abbreviation in a club-colour chip (our own drawing). This also applies to today's defense faces (`club-mark.ts`), which should become the abbreviation chip in the apps.
- **Silhouette.** $0, but loses identity; initials are better.

## Comparison

| Source | Licence for commercial app display | Coverage of active players | Yearly cost | Review risk | Rights-holder risk | Integration effort |
|---|---|---|---|---|---|---|
| Initials medallion + club colour (no photo) | Ours; nothing licensed | All | $0 | Low | Low | Trivial (built; add a club-colour table) |
| SportsDataIO headshots (Imagn) | Licensed, editorial; app use per contract | All active; rookies by preseason | Quote; est. $2k to $10k | Low | Low to medium (publicity rights, counsel Q1) | Medium (sales contract, id map, store copies on our CDN) |
| Sportradar Images (AP or Imagn) | Licensed, media use, no betting clients | All active | Quote; est. $10k to $30k+ | Low | Low to medium (same Q1) | Medium to high (manifests, Sportradar id map) |
| Imagn direct | One-time editorial, no promotion | Wide but not keyed | Quote; est. a few $k | Low | Medium | High (crop and key every image) |
| AP Images direct | Metered editorial | Wide but not keyed | Quote | Low | Medium | High |
| Stats Perform / Opta | Enterprise contract; image rights on licensee | NFL headshots unconfirmed | Quote; est. $20k+ | Low | Medium | High |
| Getty editorial | No commercial/promotional/gaming use | Needs enterprise plan for full roster | $2k for 120 images; enterprise quote | Low | Medium | High |
| NFLPA / NFL Players Inc. group licence | Likeness only, no photos | n/a | Quote; 7.5% to 10% royalty signal plus minimums | n/a | Clears likeness | Contract only; still needs photos |
| Wikimedia Commons | CC BY-SA or PD, attribution, likeness not cleared | Partial | $0 | Low | Medium | High (manual curation) |
| ESPN CDN (web today) / provider `espnHeadshot` | Personal, noncommercial only | All | $0 | Medium | High | Done |
| Sleeper CDN | Personal, noncommercial; commercial by contract | All (Sleeper ids) | $0 (unlicensed) | Medium | High | Low |
| NFL.com CDN / nflverse urls / team sites | Individual, noncommercial; no compiling | All | $0 (unlicensed) | Medium | High | Low |
| Club logos as faces | NFL trademarks | All 32 | $0 (unlicensed) | High | High | Done |

## Recommendation

Ship the iOS and Android apps with the initials medallion drawn in the player's club colour and a club-abbreviation chip in place of every team logo, including the defense rows: it costs nothing, the clients already draw it (a nil URL in iOS `Headshot.swift` and Android `apps/android/design/src/main/kotlin/app/trycommish/design/Headshot.kt`, plus a 32-row colour table), a reviewer sees no third-party mark and no rights holder has anything to claim, and keeping faces and logos out of the store screenshots removes the surface reviewers look at hardest. The runner-up, when real faces are worth paying for, is SportsDataIO's licensed NFL headshots (Imagn source, all active players, one feed keyed by player id, quote required, estimated $2,000 to $10,000 a year), with the contract stating in-app display in a commercial mobile app and the counsel answer on the NFLPA group-licensing question (counsel question 1) in hand before faces ship. Every free photo source (ESPN, the stats provider's `espnHeadshot`, Sleeper's CDN, NFL.com, nflverse, team sites) is personal or non-commercial by its own terms and fails the "cannot be credibly challenged" test. Send the stats provider one email (support@tank01.com), folded into the F3 data question: "We display your data in our iOS and Android apps. (1) Please confirm in writing that our plan covers display of your data in commercial mobile apps and storing and republishing it from our own servers. (2) Your player list returns `espnHeadshot` URLs: do you hold any licence to those images that extends to your subscribers, or are they links only? (3) Do you offer, or partner with anyone for, licensed player headshots, and at what price? (4) Which cross-ids does the player list carry (for example a SportsDataIO or Sportradar id), so we can map a licensed headshot feed?"

## Counsel questions

1. Does showing licensed editorial headshots of six or more players beside stats in a free, later paid, fantasy app require an NFL Players Inc. (OneTeam) group licence, given the C.B.C. and CBS Interactive line on names and stats?
2. Separate from the apps: the web's ESPN headshots and club marks (F3 memo, Source 3) carry the same rights-holder exposure; the founder has ruled the web keeps them, and counsel should know that the photos are unlicensed.

## Limits of this read

- Google's Impersonation page, Getty's EULA and plans, Imagn's licence page, NFL.com terms and the NFLPA material were read through a search extractor, not as full documents; the Apple, Google IP, Sleeper docs, Sleeper terms, SportsDataIO and Sportradar FAQ pages were fetched directly (still through a summarizing reader, so verify exact clause wording before relying on it in a contract).
- Every vendor price above except Getty's self-serve plan and SportsDataIO's Discovery Lab is an estimate; none publishes headshot pricing.
- Rejection practice is judgement from policy text and public reports; neither store publishes how often it checks image provenance.
