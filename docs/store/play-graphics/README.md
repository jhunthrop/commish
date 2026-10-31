# Play store graphics

The graphics the Play listing needs (docs/store/2026-10-26-play-listing.md §6), drawn by the app's own Compose screens over the shared fixtures with Paparazzi (the `:storeshots` module in apps/android), never mock-ups drawn outside the app. Upload them in Play Console by hand: nothing here talks to Play.

## Regenerate

From the repository root, with the Android toolchain (`JAVA_HOME=/opt/homebrew/opt/openjdk@17`, `ANDROID_HOME=$HOME/Library/Android/sdk`):

```sh
node apps/android/scripts/store-graphics.ts           # draw every file again into this folder, then check them
node apps/android/scripts/store-graphics.ts --check   # check the committed files only
```

The script runs `./gradlew :storeshots:testDebugUnitTest -PstoreGraphics=<this folder>`. Without that property the store tests are skipped, so CI draws nothing; CI's `node --test scripts/*.test.ts` does run the check against these committed files. Redraw after a change to any of the eight screens.

Each run also writes `scene-strings/<shot>.json`: every string the shot's screen draws from (its model, stamp and pin, and the shell's bars, read by `StoreStrings.kt`). The check fails a shot whose strings name a platform, the names read from `shared/words/league-platform.json` (`shared/store/scene-strings.ts`, Lane 310). Commit the folder with the PNGs.

## Files

| File | Size | Format | Listing slot | What it shows |
| --- | --- | --- | --- | --- |
| `icon-512.png` | 512 x 512 | 32-bit PNG, RGBA | App icon | `web/static/icons/icon-512.png` pixel for pixel, re-saved with an alpha channel (opaque) |
| `feature-graphic.png` | 1024 x 500 | 24-bit PNG, no alpha | Feature graphic | The whistle (the `Mark` composable) and "Commish" in Outfit on the dark page colour |
| `phone-1-lineup.png` | 1080 x 1920 | 24-bit PNG, no alpha | Phone screenshot 1 | "The lineup to start, every week": Lineup, Saturday noon, four changes filling every slot, "as set in your league" in the strip and the verb that makes them |
| `phone-2-waivers.png` | 1080 x 1920 | 24-bit PNG, no alpha | Phone screenshot 2 | "Your best add on waivers": Waivers, the two pickups with the best first, the position cards opening on the weakest Need (TE), and "Add in your league" pinned |
| `phone-3-trades.png` | 1080 x 1920 | 24-bit PNG, no alpha | Phone screenshot 3 | "Trades that help both teams": Trades, our best idea loaded into the builder with each side's gain and "Open trades in your league" |
| `phone-4-matchup.png` | 1080 x 1920 | 24-bit PNG, no alpha | Phone screenshot 4 | "Your game, kept up to date": Matchup, Sunday afternoon with points coming in, "Read 4 min ago" |
| `phone-5-rankings.png` | 1080 x 1920 | 24-bit PNG, no alpha | Phone screenshot 5 | "Our rest-of-season order": Rankings, every position with week 6's game beside each player |
| `phone-6-board.png` | 1080 x 1920 | 24-bit PNG, no alpha | Phone screenshot 6 | "The board in every format": the PPR draft board from its top, over replacement and the gap to ADP |
| `phone-7-mock-room.png` | 1080 x 1920 | 24-bit PNG, no alpha | Phone screenshot 7 | "Our call at every pick": a mock draft against bots at pick 5.05, our call above the pool, full screen as the app draws the room |
| `phone-8-player-page.png` | 1080 x 1920 | 24-bit PNG, no alpha | Phone screenshot 8 | "Every number with its basis": a player's page, his week's game and figures, the projection and where drafters take him |

Last drawn: every file on 2026-10-31 in Lane 310 (no platform named); the run changed phone-1 to phone-4 and left the other six byte for byte.

Upload the eight phone shots in this order: the captions are drawn into each image, so the order is the listing's §1.2.

## What the shots hold

- Dark theme, the caption in Outfit SemiBold on the surface token with the whistle above it, the screen below as the phone draws it: the top bar and the bottom bar are the app's own (`TopBar`, `PhoneTabBar`), lit on the screen's tab; the rankings, board and player page are pushed pages, so no tab is lit; the mock room is full screen, as in the app.
- The data is the shared fixtures (`shared/fixtures`) at their clocks. The fixture league is a recorded public league, so its team names and its members' handles are real people's: the store run draws from a copy with each replaced by a made-up name (`shared/store/store-names.json`, which the App Store shots read too), the league named "Sunday Standard" on a platform the lineup and the claim are made on (the copy reads its host as `espn`, which takes both). The API's own sentences that name a platform read as your league there too. Player names are public NFL players.
- The lineup shot fills every slot: in the fixture the set TE is on his bye and the bench TE is ruled out, so the store run clears the bench TE to play and starts him (`everySlotFilled` in `StoreScenes.kt`). The first shot shows the lineup working, not a hole; every other line is the fixture's own.
- No platform named (Lane 310): store screenshots are advertising Apple and Google review for other companies' marks. Every screen takes the platform's words as one parameter (`HostWords` in both apps: its name, where a move is made, a read's stamp and its own page of a kind), and the store run passes the neutral platform in `shared/store/store-host.json`, so the screens say "as set in your league", "Add in your league", "Open trades in your league" and "Read 4 min ago". The shipped apps never read that file and draw every real platform's words as before. The listing's description still names the platforms a league can be followed on.
- No team logos (D/ST rows draw the club chip), no headshots (a face draws its initials, as every snapshot does), no projection or data provider named, no league member's data.
- The cheat sheet is not in the apps yet and no caption or shot shows it; §1.2's eight captions name none of it, so none was dropped.
