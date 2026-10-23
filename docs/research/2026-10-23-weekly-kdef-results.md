# Weekly kicker and team-defense numbers: what the development check said (Amendment 7)

Run once on 2026-10-23 at 03:06Z to 03:14Z (501 s) on a scratch copy of round 4's history (`lane157_kdef` on 5433, migrated to 0021, kick columns backfilled 2016 to 2024, ESPN's archive and the defense ids loaded), feature store rebuilt from the same history (`features history --depth-chart week --first 2016 --last 2024`, 102 s). Record: `2026-10-23-weekly-kdef-dev-check.json`, claim `2026-10-23-weekly-kdef-dev-check-taken.json`. The judgment was refused by the stop rule and was not run; no claim file for it exists.

## Decision

**Kicker: no number ships. Team defense: no number ships.** Both positions fail KD2 pooled (a lead over the streamer's sheet of at least +0.02 Spearman over 15 weeks). The stop rule in Amendment 7 item 10 therefore judges neither position on 2024, and the coordinator's ruling of item 11 (2) stands: a number that cannot be told from the rule of thumb does not ship. The interim from Lane 155 stays on the Week N rankings page: kickers and defenses in the week's published projection's order, labelled as such, with no rank of ours.

## The gates, verbatim from the check

| Position | Gate | Result |
|---|---|---|
| K | KD1 pooled vs recent form | PASS, +0.0721 against +0.0500 |
| K | KD1 lower bound vs recent form | FAIL, -0.0446 against 0 |
| K | KD2 pooled vs the streamer's sheet | FAIL, -0.0162 against +0.0200 |
| K | KD2 lower bound vs the streamer's sheet | FAIL, -0.1102 against 0 |
| K | KD3 pooled vs ESPN (point comparison, archive unstamped) | FAIL, -0.0022 |
| K | KD4 starters' points vs the sheet / ESPN / recent form | 8.200 against 8.450 (FAIL) / 7.894 (PASS) / 7.606 (PASS) |
| K | KD5 floor / ceiling / median shares | PASS, 0.087 / 0.082 / 0.482, n=439 |
| K | KD6 isolation | PASS |
| DEF | KD1 pooled vs recent form | PASS, +0.2568 against +0.0500 |
| DEF | KD1 lower bound vs recent form | PASS, +0.1434 against 0 |
| DEF | KD2 pooled vs the streamer's sheet | FAIL, -0.0326 against +0.0200 |
| DEF | KD2 lower bound vs the streamer's sheet | FAIL, -0.0814 against 0 |
| DEF | KD3 pooled vs ESPN (point comparison, archive unstamped) | PASS, +0.0122 |
| DEF | KD4 starters' points vs the sheet / ESPN / recent form | 7.594 against 7.589 (PASS) / 7.672 (FAIL) / 5.711 (PASS) |
| DEF | KD5 floor / ceiling / median shares | PASS, 0.096 / 0.118 / 0.465, n=448 |
| DEF | KD6 isolation | PASS |

## What it says

The defense model beats recent form by a wide margin and edges ESPN's archived projection, but the streamer's sheet (defenses by the opponent's expected points, fewest first) is a better weekly order than the model by 0.03 Spearman on 2023. The kicker model is level with ESPN and recent form and behind the sheet. The model's points-allowed component is drawn from the team model and only tilted toward the game figures; the sheet reads the game figures directly. A second sub-round would start there, by a new amendment with its own one-shot check; nothing in this round may be re-run or re-fitted against 2023 or 2024.

## What stands

The September ruling (K and DEF in market order on the preseason board) is untouched. Lane 156's data (the kick columns, the week reads, the ESPN archive) and Lane 157's model code stay in the repository, unserved. The production backfill of the kick columns (Friday quiet window) still runs, since the data is admitted for any later round.
