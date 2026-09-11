# Sideline migration inventory

**Status:** written at the end of round one (tokens, primitives, the league front page), 2026-09-10. Every screen and component below still renders on class strings written for v5 or v6. They all already wear Sideline's palette, faces, radii and motion because the tokens moved under them, so nothing is visually broken; what remains is composition: faces first, one big number with its basis, one verb, the row and the chip primitives in place of hand-rolled spellings.

Sizes are non-test `.tsx` lines. Primitives named are the ones from `src/components/ui` a screen will consume once migrated: `Manager`, `PlayerFace`, `PlayerRow`, `BigNumber`, `Badge`/`LiveChip`, `Card`, `Button`, `MessageBubble`, `ReactionPill`, `PresenceDot`, `Celebration`, plus two not yet built (marked new).

## Suggested order

1. **Draft room** (with the fluidity round's owner). Biggest surface, the founder's peak moment, and the one Sideline strains on at desktop width (the mock answers with a wall-plus-stream split).
2. **Player page and peek**, then **the board**: research screens, dense rows at 44px with the face still present.
3. **Team page and lineup editor**: the weekly chore, one verb (Confirm or Swap).
4. **Sunday** (`room-stage-live`): the borrowed score bug and the "you need N from X" lower third.
5. **Search, the front door, the rooms** (browse, join, waiting room, mock lobby, account, admin).

## Screens

| Screen | Where | Size | Needs |
|---|---|---|---|
| Draft room (quilt, legacy board, pool drawer, advisor, clock strip, finale) | `src/draft-room/**` | 55 files, 7,607 lines | `PlayerRow` with `figure`, `PlayerFace` 36/56, `Manager` on the wall header and the turn chip, `BigNumber` for the one number per pool row, `Badge`/`LiveChip`, `Celebration` for the pick landing (self slap-in, peer spring), `MessageBubble`/`ReactionPill` in the room band, the desktop wall-plus-stream split. Blocked this hour by the fluidity round; see "What the draft room will need". |
| Draft HQ (board, hq, playbook, sheet, simulator, assistant demo) | `src/draft-hq/**` | 13 files, 1,887 lines | `PlayerRow` dense (44px), `BigNumber` with basis, `Badge`, `Card`; the sheet's modal already moved with `Modal`. |
| Player page (dossier) and peek | `src/app/app/(shell)/leagues/[leagueId]/players/**`, `src/league-room/components/player-peek.tsx`, `src/components/ui/player-object.tsx`, `source-strip.tsx`, `season-bars.tsx` | 105 + 160 + 94 + 67 + 135 lines | `PlayerFace` 132 (the hero), `BigNumber` xl with basis, `Manager` for "who has him" (rose ring for your rival), `Badge` for the position and the owner chip, the two-column 20px cards from the mock; peek rides `Modal`/`BottomSheet` (sheet slides up over the blurred ground). |
| Team page and lineup editor | `src/app/app/(shell)/leagues/[leagueId]/team`, `src/teams/**`, `src/league-room/components/lineup-editor.tsx`, `lineup-fix-sheet.tsx`, `room-spine.tsx` | 77 + 526 + 560 + spine 100 | `PlayerRow` with the slot as the control, one verb (Confirm), `BigNumber` for projected total with basis, `PlayerFace` 36 on the spine instead of stickers. |
| Sunday, the live stage | `src/league-room/components/room-stage-live.tsx`, `live-matchup-week.tsx`, `matchup-panel.tsx`, `src/components/ui/scoreboard.tsx`, `lower-third.tsx`, `game-state-chip.tsx`, `event-feed-row.tsx`, `points-share-bar.tsx` | 241 + 218 + 317 + 155 + 66 + 133 + 97 | Under the Lights' score bug and lower third (borrowed, Sunday only, new primitives `ScoreBug` and `LowerThird` restyled), `Manager` faces on both sides, `BigNumber` with `changed` sliding the new score, `useValueChangeHighlight` on the row, `LiveChip`. |
| Matchups page | `src/app/app/(shell)/leagues/[leagueId]/matchups` | 103 lines | `Manager` pairs, `BigNumber` sm per side, `Card`. |
| Standings (drawer surface and table) | `standings-table.tsx`, `room-surface-standings.tsx`, `src/components/ui/table.tsx` | 274 + 325 | `Manager` on every row (P1: owner name never hidden behind the team), four columns at most, `BigNumber` for points for, `Movement` kept. |
| The wire and trades | `wire.tsx`, `trade-card.tsx`, `trade-composer.tsx`, `trade-sheet.tsx`, `trade-inbox.tsx`, `room-surface-players.tsx`, `claim-sheet.tsx` | 372 + 250 + 176 + more | A trade as a conversation with the offer inside it (`MessageBubble` carrying a trade card), `PlayerRow` with one verb (Claim / Accept), `Manager` for both parties, `Modal` already moved. |
| Search | `src/components/app-shell/site-search.tsx`, `team-row.tsx` | 181 | `PlayerRow`/`TeamRow` already moved; needs the 12px plate hover and the `figure` slot for the one number. |
| The front door | `src/app/page.tsx`, `front-door-hero.tsx`, `home-board.tsx`, `public-league-list.tsx`, `open-league-card.tsx`, `league-rows.tsx`, `browse-filters.tsx`, `src/app/browse` | 161 + 51 + 276 + 286 + 166 + 127 + 207 | The mock's open-league row (faces of who is in, the one number "1 seat left of 12" as `BigNumber`, the featured row's amber wash and the one verb), the "people already inside" card, trust facts as 20px cards, the wire kept. |
| The rooms: join, hold, waiting room, invite landing | `src/app/join/**`, `waiting-room.tsx`, `seat-hold-panel.tsx`, `invite-landing.tsx`, `room-arrival-card.tsx` | 315 + 477 + more | `Manager` stacks for who is seated, `SeatMeter` restyled to the mock's segmented meter, one verb (Take the seat), `Celebration` for "You're in". |
| Mock drafts lobby | `src/app/app/(shell)/mock-drafts`, `mock-drafts-page.tsx` | 339 | `SegmentGroup` restyled to pill chips, one verb (Start mock draft). |
| Account room | `src/account-room/**`, `manager-header.tsx` | 16 files, 2,144 lines | `Manager` 96 at the header, `BigNumber` for seasons finished (basis), `Badge`. |
| Admin room | `src/admin-room/**`, `src/app/app/(shell)/admin` | 13 files, 1,938 + 780 | Operator surface, lowest priority: `Table` restyle, `Badge` tones, `Modal` already moved. |
| App shell: header, rail, notices, footer | `src/components/app-shell/**` | 16 files, 1,669 lines | `Manager` in the header, the rail's crest tiles on 12px, `LiveChip` for needs-you and live dots, `PresenceDot`. Two pre-existing test failures (`public-footer`, `reading-frame`) predate this round. |

## Primitives still on the old vocabulary

| Primitive | Size | Plan |
|---|---|---|
| `Table` | 325 | Row height from `TOKENS.density`, four columns at most, `Manager`/`PlayerRow` cells. |
| `Stat` | 212 | Keep the magnitude channels; compose over `BigNumber` for the block orientation. |
| `Scoreboard`, `LowerThird`, `GameStateChip`, `EventFeedRow`, `EdgeCell` | 155, 66, 133, 97, 72 | Sunday only, restyled to the borrowed score bug. |
| `PlayerObject`, `SourceStrip`, `SeasonBars`, `TowerFigure` | 94, 67, 135, 73 | The player page round; `TowerFigure` retires into `BigNumber`. |
| `ChapterBand`, `SegmentGroup`, `Sticker`, `PositionBadge`, `TierDivider` | 72, 75, 21, 110, 94 | Chip radii and the label register; the position sticker becomes the mock's 6px plate. |
| `Countdown`, `Meter`, `SeatMeter`, `Crest` | 146, 34, 72, 98 | The mock's segmented meter and the crest as a `Manager`-style tile. |
| `BottomSheet`, `DecisionSheet`, `Toast` | 50, 111, 124 | Ease-out on leave through `useLeaveTransition`, spring on arrival. |
| `Input`, `Select`, `Textarea` | 36, 56, 73 | The mock's 40px pill field (`.say input`). |
| `LiveMarker`, `InfoTip`, `Rise`, `Skeleton`, `EmptyState`, `ErrorState` | small | `LiveMarker` retires into `PresenceDot`/`LiveChip`; `Rise` retires into `useEntranceClass`; `InfoTip` is already ruled out by P7 and should be deleted with its last consumer. |

## Not built this round, stated

- **Reactions on events.** The stream carries reactions on messages (real, through the chat API). Picks, claims and trades in the stream have no reaction slot yet: it needs an `event_reactions` table keyed on the audit event id, a route, a realtime frame and a fold. Sideline says "reactions attach to all of them", so this is the next piece of the stream.
- **Scores as stream items.** A settled matchup has no settlement instant the product could honestly place in time, so results ride the rival card, not the stream. A `matchup_settled` audit event would give them a place.
- **Head-to-head history on the rival card** ("4 and 1 against Rey since 2023"): the data exists in settled matchups but no service computes it yet.
- **The desktop draft wall split** and the Sunday borrowings are rounds of their own.
