# App Store screenshots

The screenshots the App Store listing needs (docs/store/2026-10-26-app-store-listing.md §2), drawn by the app's own SwiftUI screens over the shared fixtures (the `StoreShots` package in apps/ios/Packages), never mock-ups drawn outside the app. Upload them in App Store Connect by hand: nothing here talks to Apple.

## How they are drawn

Each shot is the screen's own view model over the fixtures through a stub of the API, drawn from the screen's own parts (the parts its snapshot mock draws) inside the shell's top bar and tab bar, under its caption, by SwiftUI's `ImageRenderer` at the phone's 3x scale on a macos-26 runner with the Xcode ios.yml pins. That is the same renderer every screen's snapshot mock uses, so the shots are the screens the snapshot suite holds, and it needs no simulator: a simulator run would need the app to read fixtures, a change to the app this lane does not make. The renderer cannot draw a scroll view or the system tab bar, so each screen is drawn from its top down and cut at the phone's foot, and the bar is the shell's `TabStrip`, the five as the system tab bar draws them.

## Regenerate

On CI, never from a local draw: dispatch ios.yml with `store_shots` on the branch, then commit the `app-store-graphics` artifact's files into this folder.

```sh
gh workflow run ios.yml --ref <branch> -f store_shots=true
gh run download <run id> -n app-store-graphics -D docs/store/app-store-graphics
```

The job runs `node apps/ios/scripts/store-shots.ts`, which copies `shared/fixtures` with the recorded league's names replaced (`shared/store/store-names.json`, the Play set's file), runs `swift test` in apps/ios/Packages/StoreShots with `STORE_SHOTS` naming this folder and `COMMISH_FIXTURES` the copy, then checks the files. Without `STORE_SHOTS` the store tests are skipped, so the package tests on every push draw nothing. `--out <folder>` draws a preview elsewhere; `--check` checks the committed files only, and shared.yml runs that check (`apps/ios/scripts/store-shots.test.ts`). Redraw after a change to any of the eight screens or to the shell's bars.

## Files

Each shot comes in two sizes, the same image laid out at each phone's width: `medium-*` at 1206 x 2622 for "iPhone with Dynamic Island, medium (6.3-inch class)", required, and `large-*` at 1320 x 2868 for the large (6.9-inch class). All are 24-bit PNG with no alpha.

| Files | Slot | What it shows |
| --- | --- | --- |
| `medium-1-lineup.png`, `large-1-lineup.png` | Screenshot 1 | "The lineup to start, every week": Lineup, Saturday noon, four changes filling every slot and the verb that makes them on ESPN |
| `medium-2-waivers.png`, `large-2-waivers.png` | Screenshot 2 | "Your best add on waivers": Waivers, the two pickups with the best first, the position cards opening on the weakest Need (TE), and "Add on ESPN" pinned |
| `medium-3-trades.png`, `large-3-trades.png` | Screenshot 3 | "Trades that help both teams": Trades, our best idea loaded into the builder with each side's gain and the verb to open ESPN's trades |
| `medium-4-matchup.png`, `large-4-matchup.png` | Screenshot 4 | "Your game, kept up to date": Matchup, Sunday afternoon with points coming in and each side's projected final |
| `medium-5-rankings.png`, `large-5-rankings.png` | Screenshot 5 | "Our rest-of-season order": Rankings, every position with week 6's game beside each player |
| `medium-6-board.png`, `large-6-board.png` | Screenshot 6 | "The board in every format": the PPR draft board from its top, over replacement and the gap to ADP |
| `medium-7-mock-room.png`, `large-7-mock-room.png` | Screenshot 7 | "Our call at every pick": a mock draft against bots at pick 5.05, our call above the pool, full screen as the app draws the room |
| `medium-8-player-page.png`, `large-8-player-page.png` | Screenshot 8 | "Every number with its basis": a player's page, his week's game and figures, the projection and where drafters take him |

Upload the eight at each size in this order: the captions are drawn into each image, so the order is the Play listing's §1.2, which the App Store listing follows.

## What the shots hold

- Dark theme, the caption in Outfit SemiBold on the surface token with the whistle above it, the screen below as the phone draws it: the top bar and the tab bar are the shell's (`TopBar`, `TabStrip`), lit on the screen's tab; the rankings, board and player page are pushed pages, so no tab is lit, as in the Play set; the mock room is full screen, as in the app.
- The same scene as the Play set (docs/store/play-graphics/README.md): the shared fixtures at their clocks, the recorded league's team names and handles replaced by made-up names from `shared/store/store-names.json`, the league named "Sunday Standard" and read as ESPN; the lineup fills every slot (the bench TE cleared to play and started, `everySlotFilled` in `StoreScenes+InSeason.swift`, as `StoreScenes.kt`); no team logos (D/ST rows draw the club chip), no headshots (a face draws its initials, as every snapshot does), no projection or data provider named. The member's platform is named where the screen names it ("as set on ESPN", "Add on ESPN", "Open ESPN trades").
- Every screen of §1.2 is in the iOS build, so no caption was dropped.
