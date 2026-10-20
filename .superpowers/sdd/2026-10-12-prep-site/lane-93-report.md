# Lane 93 report: the record's yardstick and the page that says it

Branch `worktree-agent-a565bf90f24b8fcc6`, from `29f9d1c7`. Entries B04, B18, B03, B37, B45.

Commits:
- `fc64f711` feat(research): the register keeps the order the site ships, set on the final pass (its message also describes a capture-window change, reverted by `e523caf3`)
- `2b0398e9` feat(api): keep ESPN's own week projection for every attached ESPN league and grade our picks against it
- `e523caf3` revert(research): leave the harvest's projection schedule as it was (coordinator's ruling: the harvest is B68's)
- `bd7b7356` feat(api): the league record's margin to the tenth, and the record's amendment
- `def1e6be` feat(web): the record says what it graded, in a player's words, and in a league's own lineup

Trailer: `Co-Authored-By: Claude Opus 5.5` (the model that did the work; the brief's template named another).

## What I found

### Ruling 1a, the published projection at the freeze: the premise is wrong as scheduled
- The freeze keeps `published_points` from the newest `tank01_projection_rows` snapshot read at or before the freeze (`research/model/register/freeze.py` `_PUBLISHED`, `week_published_points`).
- The only capture of a week's projection is in each kickoff slot's window, `LEAD = 2h` before the slot's first game (`research/pipeline/kickoff_slots.py` `LEAD`, `due_slot`; `research/pipeline/tank01/projections.py` `projection_slot_due`; `research/pipeline/tank01/capture.py` `run_capture_harvest`). The coordinator's production read agrees: week 1 has one snapshot (Sep 9), weeks 2 to 5 have none, and week 6's first landed Oct 17 03:14Z, after its Thursday game kicked off.
- **Thursday Oct 22 as the code now schedules it:**
  - The register's passes run Tue 08:00, Wed 18:00 and Thu 14:00 Eastern (`research/JOBS.md`).
  - Week 7's first kickoff is Thu 20:15 Eastern (Fri 00:15Z).
  - With this lane merged and the research image deployed, the **Thursday 14:00 Eastern pass sets the order** (new `FINAL_FREEZE_BEFORE = 12h` in `research/inseason/season_week.py`). It supersedes the early freeze the Tuesday 08:00 pass takes.
  - The week 7 projection's **first capture is the 19:00 Eastern hourly harvest**, inside the Thursday slot's 18:15 to 20:15 window. That is five hours after the freeze, so the freeze keeps `published_points` NULL again.
- **What must be true by Thursday:** a capture of the week 7 projection has to land before 14:00 Eastern Thursday, which is the harvest lane's job (B68). The other way, moving the freeze after 19:00, would leave 75 minutes before kickoff and no retry pass, so I do not recommend it. Following your message I reverted the capture-window change I had made (`e523caf3`) and left the harvest schedule as it was. The page draws Published only once a graded week carries it, and names the start week from the register, else the next week to be set. So with no capture it moves on honestly: "From week 8 ...".

### Ruling 1b, ESPN's projection: the payload carries it, so I built it
- ESPN's `view=mRoster` read carries, per rostered player, `player.stats[]` with `statSourceId` 1 (ESPN's projection) and 0 (what he scored), `statSplitTypeId` 1 (one scoring period), `scoringPeriodId`, and `appliedTotal` in the league's own scoring.
- I verified this on the public league 48153503 (2019), read with no sign-in. With `scoringPeriodId=7` it answers periods 6 and 7 for both sources, for example Dalvin Cook projected 19.60 and scored 28.
- Our reader dropped it: `api/internal/espn/league.go` `wirePlayer` and `wireEntry` decode no `stats`.
- **Why the table is not on the research side:** only the API holds a member's ESPN cookies, and the API's role owns `app`, not `research`.
- What I built instead:
  - `app.espn_week_reads`, keyed by league, season, week, read time and player (migration 00028), written by the API's new `espn-week-reads` job.
  - The member's league grading, computed by the API from those reads and from the register's set order (`research.register_freeze_rows`, read the way the API already reads other research tables).

### Ruling 2, B18: the freeze really kept the preseason order
`take_freeze` read only `preseason_projections` (`commish_board_v9_ppr_12` and v7), while every screen showed `published_boards`, the rest-of-season order. Per the ruling I changed the freeze, not the label:
- `SHIPPED_SOURCE = commish_ros_shipped_ppr_12` is read from `published_boards` (ppr, `rest_of_season`, published at or before the freeze, through the crosswalk). It stores rest-of-season points as the stance, its rank as both ranks, and `published run <id>` as the model.
- It is frozen beside the preseason board.
- The record grades a week through the shipped order wherever that week's freeze kept it, and names it: "Our rest-of-season order, refreshed Oct 22".
- Weeks 1, 2 and 6 stay graded or waiting as preseason. Weeks 3 to 5 are not back-filled.
- There is no research migration (it is a new `board_source` value). The parity cases are unaffected because the scratch copy has no published board.

## What I changed, by ruling
1. **Yardsticks.**
   - (a) Kept as built. The page draws Published once kept and its basis names the start week.
   - (b) ESPN capture and grading:
     - `espn.Client.ReadWeek` reads one period.
     - `espnhost.Member.ReadWeek` reads it with the member's cookies.
     - `leaguerecord.ESPNWeeks` reads as a connected member, else falls back to the public read.
     - `leaguerecord.Capture` and the `espn-week-reads` job (added to `api.yml`) write the reads.
     - `GET /leagues/attached/{id}/record` answers the league's lineup and teams and, per graded week, `{week, benchmark: espn|published, ours, theirs, margin}`.
     - How the grading works: the newest read of week W taken at or before the week's set time gives the roster and ESPN's projection; the newest read after the register graded W gives the points. Our lineup fills the league's slots by our set order, ESPN's lineup by its projection, from the same roster. Bye, Out, IR and suspended players are left out, and so are kickers and defenses.
     - ADP stays on the draft board only. The rest-of-season board drops its ADP column and its drafts sentence.
2. **B18:** as above.
3. **B03:**
   - The page's head and the front card say "Graded 2 of 5 weeks played" beside the figure, then "Weeks 3 to 5 were not set before kickoff, so they cannot be graded. Week 6 grades Wednesday when the stats land."
   - Wording note: I applied the "set, not freeze" rule to the ruling's sentence. It reads "not set before kickoff" where the ruling said "not frozen".
   - The front card draws starters right beside order matched.
   - The missed note now reads "Our order was not set before kickoff that week." and the method reads "Each week we set our order before the first kickoff ...".
4. **B04 columns and words:**
   - Order matched has a one-line definition in the basis: "1.00 is the same order, 0.00 no closer than chance, below it the reverse".
   - Places off: "the average number of places a player finished from where the order put him, lower is better".
   - "Rates print to two decimals" is gone.
   - "Players graded"; the to-date row reads "203 distinct".
   - Starters right counts the standard 12-team lineup and says so. Opened from a league, it counts the league's own lineup (flex and superflex) from each graded week's placed players, which the run now carries and the build writes to `/data/record-players.json`. The page fetches that file only once a league is selected.
   - The TypeScript count equals the run's own count on the standard lineup, every line and every week, on the live record (`record-starters.test.ts`).
   - The footer's Published sentence names the week: "From week 7 each week is also graded against the week's published projection." For an ESPN league it adds the ESPN sentence.
   - The in-season board's ADP column is gone.
5. **B37 and B45:**
   - The status reads "Set Tue Sep 8, graded Tue Oct 13" (dates from the dev copy; production graded Oct 14), "Set Tue Oct 13, grades Wed Oct 21 when the stats land", and "Set before kickoff Thu Oct 22".
   - There is one set time a week: the final pass in the 12 hours before the first kickoff supersedes the early freeze.
   - The chart draws only the graded weeks and is captioned "Order matched by week, 2 weeks graded".
6. **The member's sentence:** "Week 7: our picks beat ESPN's projected lineup by 8.4 points, 112.4 to 104.0." It mirrors when ESPN's lineup wins, says when they tie, and has a published-projection variant.
   - The computation, template and tests are in place: `leaguerecord/grade_test.go`, `inseason/record_test.go`, and the shots against the fixture API's stand-in week.
   - **It first draws Thursday Oct 29, 13:30 Eastern.** Week 7 grades on the Wednesday Oct 28 18:00 pass. The Wednesday 19:00 read would be the first after that grading, but it asks ESPN for period 8 and keeps only the team rows that read carries, and the member's team has to appear in a week 7 read taken before the order was set. So the first draw is the Thursday Oct 29 13:30 read, provided the Thursday Oct 22 13:30 read ran before the week 7 order was set.
   - Leagues on other platforms get no sentence. The API keeps no weekly per-player points for them, which is an open question.
- The record amendment is in `docs/research/2026-10-16-weekly-projection-round4-preregistration.md` §7, Amendment 4.

## What must be true by Thursday Oct 22, before 14:00 Eastern
1. This branch is merged, and the research image (`research.yml`) and the API (`api.yml`, which runs migration 00028 and deploys the `api-espn-week-reads` job) are deployed. Otherwise the Thursday pass sees week 7 "already frozen" from Tuesday's preseason-only freeze, and the shipped order is lost for week 7.
2. A capture of the week 7 published projection lands before 14:00 Eastern (B68). Without it the week 7 freeze keeps no published projection.
3. Cloud Scheduler entries exist for `api-espn-week-reads`: `30 13 * * 4` and `0 19 * * 3`, America/New_York (the commands are in `infra/README.md`). These are hand-made, so I did not create them. One manual run of the job on Thursday between 13:30 and 13:55 Eastern would also do for week 7.
4. Check that the `commish_app` role can select `research.register_freeze_rows`, `register_grade_rows` and `players`. If it cannot, the record route answers no weeks with one warning.

## Gates (exit codes)
- web `npm run check` 0, `npm run lint` 0, `npm run standin` 0, `npm run build` 0, `npm test` 0 (682 tests, 0 failed), `node scripts/script-bytes.ts` 0 (player page 70,801 B gz, under 73,728; /record 80,428 B gz).
- api `gofmt -l` empty, `go vet` 0, `go build` 0, `make check-gen` 0, `CI=true TEST_DATABASE_URL=.../lane93_api_test go test -race -count=1 -p 1 ./...` 0.
- research `ruff check` 0, `ruff format --check` 0, `mypy -p research` 0, `pytest` 0 (1717 passed, with `PARITY_DATABASE_URL` on 5433), `python -m research.parity ingest tank01-capture-harvest` 0 (match; the harvest code ended unchanged anyway).
- Shots: `node scripts/record-shots.ts` 0, no faults. It runs at 1280 and 390, on the record the nightly writes from the dev copy (read-only) on Monday night of week 6, with the fixture API on clock 2026-10-21T14:00Z, signed out, with the ESPN stand-in, and with the Sleeper league. The ESPN week 7 line is a stand-in, labelled in `scripts/inseason-fixture/record.ts`.

Shots are in `lane-93-shots/`: `record-{signed-out,espn,sleeper}-{1280,390}.png`, `front-{1280,390}.png`. In the 390 full-page shots the fixed bottom navigation sits over the middle of the page; that is how full-page capture draws a fixed bar, not a layout fault.

## Deploy-pair check
Everything is additive:
- New route, table and job. The run gains optional fields `orderAsOf`, `gradesFrom` and `players`; nothing non-null turns nullable.
- New web with the old API: `/record` fails, so the page keeps the run's own record and standard lineup and draws no league section.
- Old web with the new API: unaffected.
- The new web parses a run without the new fields (standard counts; "grades when the stats land").
- The old web reads the new missed note as "not frozen because our order was not set before kickoff, so not graded". That is awkward but true, for one deploy.

## Concerns and open questions
- The `fc64f711` message still describes the capture change that `e523caf3` reverts. Squash on merge if a clean history matters.
- Opened from a league, starters right counts the league's lineup while the honest line keeps the run's standard count. The honest line now says "in the standard lineup" so the two do not read as a contradiction.
- The ESPN comparison picks our lineup by the rest-of-season order, the order we ship. Our picks therefore carry no week-specific matchup view against ESPN's weekly projection; the basis says so plainly.
- Other platforms have no per-week host points capture, so their leagues get no sentence.
- Migration 00028 and the order-shots or record files may collide with the parallel lanes' numbering or edits to the front door's board (the board replacement-level lane).
