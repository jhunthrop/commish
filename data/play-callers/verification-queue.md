# PFR verification queue

Rows whose Wikipedia sourcing carried doubt. Verify each against the founder's PFR account (interface/Stathead exports at human rates, never a crawler; phase-8 ledger 2026-08-31) and upgrade `source` to `both` on confirmation.

## pc-g1.doubts

1999 ATL: Infobox titles George Sefcik "Offensive coordinator/running backs" but separately lists Jack Burns as "Passing Game/Play Calling". This is unusual phrasing suggesting Burns may have handled play-calling duties, but he was not formally titled OC (and the role schema only allows HC/OC), so Sefcik was recorded as OC per his formal title. Not present in 2000/2001 ATL articles for the same staff.

2002 ARI: No article prose confirms whether OC Rich Olson called plays or HC Dave McGinnis did; used formal OC title.

2002 ATL: No offensive coordinator is listed anywhere in the infobox for this season (only position coaches under "offensive"); recorded HC Dan Reeves as the play-caller by inference from the missing OC title, consistent with the pattern used elsewhere in this dataset (e.g. Cardinals 2009-2010, 2019-2022) but not confirmed by explicit prose for this specific season.

2008 ATL: The January offseason transaction log lists both "Jan 25 – Named Mike Mularkey offensive coordinator" and "Jan 26 – Named Terry Robiskie offensive coordinator" on consecutive days, which is contradictory as written. The season's final coaching-staff infobox confirms Mularkey as the OC, which was used as the tiebreaker; Robiskie's actual January role is unclear from the text.

2009 ARI: No offensive coordinator is listed in the infobox (only "Pass game coordinator" and "Assistant head coach/run game coordinator" roles); recorded HC Ken Whisenhunt as the play-caller by inference from the missing OC title. Not directly confirmed by prose.

2010 ARI: Same situation as 2009 — no OC listed in infobox; HC Ken Whisenhunt recorded as play-caller by inference, not directly confirmed by prose.

2013-2017 ARI: Bruce Arians attributed as HC/play-caller solely via the reputation list (instructions line 9, "Bruce Arians (ARI as HC years)"). The season articles list Harold Goodwin as the formally titled offensive coordinator for all five years and are silent on who actually called plays.

2018 ARI: Offensive coordinator Mike McCoy was fired Oct 19, 2018; the schedule shows this fell between the Week 6 game (at Minnesota) and Week 7 game (vs Denver), so the split was estimated at week 6/7 rather than from an exact stated week number.

2019-2022 ARI: No offensive coordinator is listed in any of these four seasons' infoboxes under HC Kliff Kingsbury (well known externally to have called his own plays, but Kingsbury is not on the provided HC-reputation list). Recorded as HC per the missing-OC-title pattern; not directly confirmed by in-article prose for any of the four seasons.

2021-2023 ATL: Arthur Smith attributed as HC/play-caller solely via the reputation list (instructions line 9, "Arthur Smith (ATL as HC)"). Dave Ragone is the formally titled OC for all three years; the articles are silent on who actually called plays.

2026 ATL: The 2026 season article text is silent on the offensive coordinator (new HC Kevin Stefanski, not on the reputation list). Confirmed OC name (Tommy Rees) via a live fetch of the current en.wikipedia.org article rather than the provided wiki/ text file, per the instructions' allowance to fetch season articles when silent.

2006 BAL: Jim Fassel was fired as OC on Oct 17, 2006, with HC Brian Billick assuming play-calling duties himself; the 2008 article explicitly states Billick had no true OC for the rest of 2006 and all of 2007. Week 6/7 split for Fassel/Billick was inferred from the schedule (bye week fell in week 7, game context places the firing right after the week 6 game) rather than a stated week number.

2007 BAL: HC Brian Billick recorded as play-caller for the full season per the explicit 2008-article statement that Rick Neuheisel was only "listed on the coaching staff in that capacity" without truly functioning as OC.

2018 BAL: The infobox off_coach field lists only Marty Mornhinweg for the season, but the staff list separately shows Greg Roman as "Assistant head coach/interim offensive coordinator" with no in-season transition text explaining when or whether Roman actually took over play-calling (contrast with the 2016 BAL infobox, which explicitly lists both Trestman and his interim replacement in the off_coach field with a fired date). Recorded Mornhinweg as full-season OC per the infobox field.

2003-2004 BUF: Neither season article contains a coaching-staff or infobox section listing assistant coaches at all. OC names (Kevin Gilbride for 2003, Tom Clements for 2004) were confirmed via live fetches of the coaches' own Wikipedia biography pages rather than the season article text files, per the instructions' allowance to fetch coach articles when a season article is silent.

2010-2012 BUF: The 2010 article explicitly states HC Chan Gailey called the offensive plays himself while Curtis Modkins was "the nominal offensive coordinator." No equivalent statement appears in the 2011 or 2012 articles, but the same Gailey/Modkins staff arrangement continued unchanged across all three seasons with no reported OC change, so HC Gailey was extended as play-caller through 2011 and 2012 as a best guess rather than a directly confirmed one.

2026 BUF: New HC Joe Brady was promoted directly from the Bills' own OC position; Pete Carmichael Jr. was named his replacement as titled OC. The article does not state whether Brady retained play-calling duties for himself (as some promoted-from-OC head coaches do) or handed them fully to Carmichael. Recorded OC Carmichael per his formal title; Brady is not on the provided HC-reputation list.

## pc-g2.doubts

2019 CAR: Article names Norv Turner as OC and Scott Turner as "interim offensive coordinator/quarterbacks" but gives no date for the handoff. Ron Rivera (HC) was fired December 3, two days after a Week 13 loss to Washington; Perry Fewell went 0-4 as interim HC over the final four games (weeks 14-17), which cleanly implies Rivera's 5-7 record covered weeks 1-13. Assumed Norv Turner's OC tenure ended at the same organizational shakeup (weeks 1-13), with Scott Turner taking weeks 14-17, but this is inferred from the coincident timing, not stated in the article.

2021 CAR: Article states Joe Brady was "fired mid season" with Jeff Nixon as interim OC, but gives no date. Fetched Joe Brady's own Wikipedia biography page (per instructions, additional coach pages are allowed) which states he was fired December 5, 2021. The season article's own game log shows Carolina's Week 12 game (loss to Miami, dropping them to 5-7) was immediately followed by a bye in Week 13, and Dec 5, 2021 fell within that bye week. Assigned Brady weeks 1-13 (through the bye) and Nixon weeks 14-18; the exact boundary (whether Brady's firing should count against week 12 or 13) is a judgment call since no game was played in the bye week.

2026 CAR: This is a season-preview article (season has not been played). No offensive coordinator is named anywhere in the article. Recorded Brad Idzik (the 2024-2025 incumbent OC) as a best guess for the full season; this is uncorroborated by the source article itself.

2000 CHI: Infobox lists Gary Crowton as OC and John Shoop as "Quarterbacks/Interim Offensive Coordinator" but the article gives no transition date. Fetched Gary Crowton's Wikipedia biography, which also does not give an exact departure date from the Bears, only that he became BYU's head coach starting the 2001 season (a hire that, per outside general knowledge, was announced in mid-December 2000). Estimated the transition at week 15 using the instructions' date-to-week formula and a reconstructed December 11, 2000 hire-announcement date; this exact date could not be confirmed from Wikipedia sources.

2025 CHI: The article's infobox names Declan Doyle as offensive coordinator under head coach Ben Johnson, and prose is silent on who called plays. The parse instructions list "Ben Johnson (CHI 2026→)" as a well-known standing HC play-caller, with the arrow explicitly scoping that reputation-based treatment to 2026 onward, not 2025 (Johnson's first Chicago season). Followed the instructions literally and used OC Declan Doyle as the play-caller of record for 2025, even though it is plausible Johnson called plays in his first Chicago season too (as he had at Detroit). Flagging in case the 2026-only scoping was not intended to exclude 2025.

1999 CLE: This is the Browns' inaugural expansion-team season and the article's coaching-staff section lists only a defensive coordinator (Bob Slowik) — no offensive coordinator is named anywhere in the infobox or prose. A prose aside describes Bruce Arians as a "former Browns offensive coordinator" in the context of defending Tim Couch's career, but Arians did not join Cleveland as OC until 2001 per that season's own infobox, so this appears to be either a loose Wikipedia phrasing or an editing error, not evidence he was 1999 OC. Recorded head coach Chris Palmer as the play-caller as a best guess (expansion-team HCs with QB-coaching backgrounds not uncommonly ran their own offense in year one), but this is unconfirmed by any source consulted.

2016 CLE, 2017 CLE: Under head coach Hue Jackson (himself a former Bengals OC), the coaching-staff infobox lists a "Run game coordinator/running backs" but no offensive coordinator at all in either season. Inferred that Jackson called the plays himself in the absence of a hired OC (by elimination), consistent with how the 2011 Browns explicitly stated Pat Shurmur would call plays after choosing not to hire an OC. No prose in either 2016 or 2017 CLE explicitly confirms Jackson as play-caller, unlike the 2011 case.

## pc-g3.doubts

1999 DAL: infobox off_coach field is blank and no OC/play-caller named anywhere in the article; best-guessed HC Chan Gailey as playcaller.
2006 DAL: staff list has no "Offensive Coordinator" title after Sean Payton left for New Orleans (only WR/passing-game and OL/run-game coordinators); best-guessed HC Bill Parcells as playcaller.
2008 DAL: article has no coaching-staff section and no coordinator mentions at all; best-guessed continuation of Jason Garrett as OC from 2007/2009 articles.
2011 DAL: staff list has no "Offensive Coordinator" title (only Tight ends/pass game coordinator and OL/run game coordinator); best-guessed HC Jason Garrett as playcaller.
2026 DAL: season in progress as of article snapshot; no coaching-staff section published; best-guessed continuation of Klayton Adams as OC from 2025.
1999-2008 DEN: applied hc-playcaller-by-reputation rule for Mike Shanahan over named OCs (Gary Kubiak 1999-2005, Rick Dennison 2006-2008); no explicit prose statement of who called plays, only staff-list OC titles.
2009-2010 DEN: applied hc-playcaller-by-reputation rule for Josh McDaniels weeks 1-13 of 2010 (and all of 2009) over named OC Mike McCoy; no explicit prose statement of who called plays.
2023-2026 DEN: applied hc-playcaller-by-reputation rule for Sean Payton over named OCs (Joe Lombardi 2023-2025, Davis Webb 2026); no explicit prose statement of who called plays.
2026 DEN: article reflects season in progress as of snapshot date (offseason coaching moves only); best-guess full-season row for OC continuity/reputation-based HC.
2005 DET: week split between Ted Tollner and Greg Olson estimated from Thanksgiving Day (Nov 24, 2005) firing/promotion news dated Nov 28; exact week boundary (12/13) approximate.
2020 DET: week split for Darrell Bevell OC-to-interim-HC estimated from Thanksgiving Day (Nov 26, 2020) firing of Matt Patricia; exact week boundary (12/13) approximate.
2026 DET: article reflects season in progress as of snapshot date; no coaching-staff section published; best-guess continuation of John Morton as OC from 2025.
2012-2014 GB: exact start of Tom Clements' play-calling tenure inferred from the 2015-GB retrospective text ("Mike McCarthy takes back Packers' playcalling duties... after relinquishing it to Tom Clements"); assumed to span Clements' full OC tenure (2012 promotion through Dec 13, 2015).
2016-2018 GB (weeks 1-13): Mike McCarthy's play-calling role carried forward from the confirmed Dec 13, 2015 change (NFL.com/ESPN sourced); no explicit article statement reconfirms it for 2016, 2017, or 2018.
2019-2026 GB: applied hc-playcaller-by-reputation rule for Matt LaFleur over named OCs (Nathaniel Hackett 2019-2021, Adam Stenavich 2022-2026); no explicit prose statement of who called plays.
2026 GB: article reflects season in progress as of snapshot date (offseason coaching moves only); best-guess continuation of LaFleur as reputation playcaller.

## pc-g4.doubts

2003 IND: article silent on offensive coordinator; assumed Tom Moore continuity from his known 1998-2009 tenure as Colts OC.
2004 IND: article silent on offensive coordinator; assumed Tom Moore continuity.
2005 IND: article silent on offensive coordinator; assumed Tom Moore continuity.
2026 IND: article silent on 2026 offensive coordinator; assumed Jim Bob Cooter continuity from 2023-2025.
2022 IND: Frank Reich fired "November 7" with a 3-5-1 record; mapped to end of week 9 by best-effort game-count, not a stated week number. Also, real-world OC Marcus Brady was reportedly dismissed shortly before Reich (~week 8-9) and replaced by interim OC Parks Frazier while Reich was still HC, but the article only names Parks Frazier as "interim offensive coordinator" without a date, so the CSV simplifies to Reich(HC, playcaller-by-reputation) through week 9, then Frazier(OC) week 10-18.
1999 JAX: no offensive coordinator listed anywhere in the staff section (off_coach infobox field is blank); assumed HC Tom Coughlin functioned as playcaller since no OC existed on staff.
2000 JAX: same as 1999 — no OC listed on staff; assumed HC Coughlin as playcaller.
2002 JAX: same as 1999/2000 — no OC listed on staff (Coughlin's final season); assumed HC Coughlin as playcaller.
2011 JAX: Jack Del Rio fired November 29; defensive coordinator Mel Tucker took over as interim HC. Article does not state whether OC Dirk Koetter retained offensive playcalling under Tucker; assumed yes since Tucker's background is defense and no OC change is mentioned.
2016 JAX: Greg Olson was offensive coordinator to start the season and Nathaniel Hackett is listed as "interim offensive coordinator/quarterbacks" later in the staff list, but the article gives no date or week for the transition. Used a best-guess split at week 6/7 (not sourced to a specific event in the article).
2018 JAX: Nathaniel Hackett was OC to start the season; Scott Milanovich is listed as "interim offensive coordinator/quarterbacks" later, but no date/week is given in the article for the change. Used a best-guess split at week 11/12 (not sourced to a specific event in the article).
2005 HOU: Chris Palmer (OC) and Joe Pendry ("offensive coordinator/offensive line") are both listed in the staff section with no narrative explaining the transition or date. Used a best-guess split at week 9/10 assuming Palmer was replaced mid-season; not confirmed by the article.
2013 HOU: Gary Kubiak (HC) collapsed on the sideline mid-game in week 9-ish and was fired December 6; Wade Phillips (DC) served as interim HC weeks 15-17. Article does not state whether OC Rick Dennison retained offensive playcalling under Phillips; assumed yes since Phillips's background is defense.
2015 HOU: George Godsey is the named offensive coordinator, but Bill O'Brien is widely known (outside this article) to have called plays himself as HC throughout his Texans tenure. The article does not state who called plays either way, so the row follows the default rule (named OC) — this may undercount O'Brien's real playcalling role.
2016 HOU: same issue as 2015 — Godsey named OC, O'Brien's actual playcalling role not confirmed or denied by the article.
2019 HOU: same issue — Tim Kelly named OC, O'Brien's actual playcalling role not confirmed or denied by the article.
2020 HOU: O'Brien fired October 5 after an 0-4 start; Romeo Crennel (DC) served as interim HC weeks 5-17. Unclear from the article whether O'Brien or OC Tim Kelly called plays in weeks 1-4, and whether Kelly's role changed under Crennel. Recorded as one continuous OC Kelly row for the full season as best guess.
2026 HOU: article silent on 2026 offensive coordinator; assumed Nick Caley continuity from 2025.
2017 KC: Article states Andy Reid gave playcalling duties to OC Matt Nagy "during" a stretch where the Chiefs lost 6 of 7 games after a 5-0 start (roughly weeks 6-12), but does not give an exact week the change occurred or state whether Reid resumed playcalling for the remainder of the season. Used a best-guess split at week 5/6, assumed Nagy retained duties through the end of the season.
2011 KC: Todd Haley (HC) fired December 12 (after the week-14ish Jets loss); Romeo Crennel (DC) served as interim HC for the final weeks. Article does not state whether OC Bill Muir retained offensive playcalling under Crennel; assumed yes since Crennel's background is defense.

## pc-g5.doubts

2009 OAK: No offensive coordinator named anywhere in the article (infobox lists only "Passing game coordinator – Ted Tollner"). Best-guess row assigns HC Tom Cable as play-caller since Cable was previously the OL coach and no delegated OC is documented.

2021 LV: After Jon Gruden's October 11 resignation, interim HC Rich Bisaccia (a special teams coach) took over; the article does not state who called offensive plays for weeks 6-18. Best-guess row keeps OC Greg Olson as play-caller since he remained listed as OC and Bisaccia has no offensive background.

2019 LAC: The season article never mentions Ken Whisenhunt by name at all — only "Interim offensive coordinator – Shane Steichen" appears, implying a predecessor was fired but not naming him or the date. Whisenhunt's firing (October 28, 2019, day after beating the Bears in Week 8) was sourced from Ken Whisenhunt's own Wikipedia article per the instructions' allowance to fetch additional Wikipedia pages when the season article is silent.

2026 LAC: The season article contains no coaching-staff section at all beyond naming HC Jim Harbaugh. OC Mike McDaniel (hired January 26, 2026, after being fired by Miami) was sourced from Mike McDaniel's Wikipedia article.

2005 STL: After Mike Martz left the team October 10 due to illness, interim HC Joe Vitt took over for weeks 6-17. No offensive coordinator or play-caller is named anywhere in the article or in Joe Vitt's Wikipedia article. Best-guess row assigns HC Joe Vitt as play-caller by default, but this is unconfirmed.

2008 STL: The article names no offensive coordinator at all (only the Linehan-to-Haslett head-coaching change is described). Best-guess row carries over Greg Olson, the 2007 OC, absent any statement that he left or was replaced.

2015 STL: The infobox/coaches list names Rob Boras as offensive coordinator for the full season, but body prose separately states "offensive coordinator Frank Cignetti Jr. was fired" the day after the game that dropped the team to 4-8 (~week 12). Cignetti is not listed in the coaches section at all. This may be a Wikipedia editorial imprecision (Cignetti was more likely passing-game coordinator), but the two sources conflict. Row uses the infobox's Rob Boras for the full season.

1999 MIA: The article names no offensive coordinator or coordinator of any kind — only head coach Jimmy Johnson is identified. Wikipedia searches (Jimmy Johnson's article, Dolphins-Jets rivalry article) did not surface a name for this specific season (Chan Gailey's Dolphins OC tenure was confirmed to start in 2000, not 1999). Best-guess row assigns HC Jimmy Johnson as play-caller absent any other evidence.

2026 MIA: The season article states only that HC Jeff Hafley was hired (January 19, 2026) after Mike McDaniel's firing; no coordinator staff is listed. OC Bobby Slowik (promoted from senior passing-game coordinator) was sourced from Bobby Slowik's Wikipedia article.

## pc-g6.doubts

2018 MIN: Season article never names John DeFilippo (2018 OC); only the interim replacement Kevin Stefanski appears in the infobox. Confirmed DeFilippo's tenure and "week 14" firing via his own Wikipedia article (John DeFilippo), not the season article. Exact calendar date of firing not given, only "week 14."
2005 NE: Article states Belichick did not replace Charlie Weis as OC for 2005 (only Crennel's DC slot was refilled, by Eric Mangini). No text says who actually called plays; best-guess row assigns it to HC Bill Belichick. Actual play-caller could have been a QB coach or committee arrangement not described in the article.
2009 NE: No official OC was named after Josh McDaniels left for Denver. Bill O'Brien is only listed as "quarterbacks coach." Assigned him the OC/play-caller role as a best guess (he became the formal OC in 2011), but the article does not confirm he called plays in 2009.
2010 NE: Same situation as 2009 — no formal OC in the article; Bill O'Brien (titled "Quarterbacks") assigned as best-guess play-caller.
2022 NE: Matt Patricia's listed title is "Senior football advisor/offensive line," not offensive coordinator. Assigned OC role because prose explicitly states he "was given offensive playcalling duties," but the title mismatch is worth flagging.
2026 NO: Article has no offseason coaching-staff section, no off_coach infobox field, and no coordinator mentions anywhere. Best guess retains 2025 OC Doug Nussmeier since no departure is reported.
1999 NYG: Article names no OC for weeks 1-12. Prose only states that QB coach Sean Payton "would take over the Giants' offensive play-calling duties" before the Week 13 Jets game, implying someone else called plays before that — presumed to be HC Jim Fassel (best guess; not stated explicitly in the article).
2003 NYG: Article contains no coaching-staff section and no coordinator mentions at all. Best guess is HC Jim Fassel self-called plays (mirroring his 1999 pattern) since Sean Payton had departed for Dallas after the 2002 season; this is not confirmed by any text in the file.
2004 NYG: Article contains no coordinator mentions. OC name (John Hufnagel) and tenure (2004-2006) confirmed only via his own Wikipedia article, not the season article itself.
2005 NYG: Same as 2004 — John Hufnagel's OC role confirmed only via his external Wikipedia article, not the season article.

## pc-g7.doubts

2026 NYJ: Article is a pre-season preview (record 0-0) with no coaching-staff section at all — no OC named for 2026. Best guess: Tanner Engstrand (2025 OC) continues; no explicit confirmation found.

2005 PHI: The "final staff" infobox lists both "Assistant head coach/offensive coordinator – Marty Mornhinweg" (under head_coach section) and "Offensive coordinator – Brad Childress" (under offensive section) for the same season. Went with Childress as the actual play-calling OC (he left after 2005 to become Vikings HC; Mornhinweg is listed as sole OC starting the 2006 article), but the dual titling in the source is ambiguous.

2013 PHI: Chip Kelly attributed as HC/play-caller solely via the reputation list (instructions line 9); prose in the 2013 article is silent on who actually called plays.

2014 PHI: Same as 2013 — Chip Kelly via reputation list only, prose silent on play-calling.

2015 PHI (weeks 1-16): Chip Kelly via reputation list only for weeks 1-16; prose is silent on play-calling attribution (only confirms firing date/record split with Shurmur for week 17).

2016 PHI: Doug Pederson attributed as HC/play-caller via reputation list; prose silent on play-calling that season (OC of record was Frank Reich).

2017 PHI: Same as 2016 — Doug Pederson via reputation list, prose silent (OC of record Frank Reich).

2018 PHI: Same — Doug Pederson via reputation list, prose silent (OC of record Mike Groh).

2019 PHI: Same — Doug Pederson via reputation list, prose silent (OC of record Mike Groh).

## pc-g8.doubts

2004 SF: Season article never names an offensive coordinator; sourced Ted Tollner from his own Wikipedia bio page (confirmed 2004 promotion from QB coach to OC), not the season article itself.
2010 SF: Article states Jimmy Raye was fired "after their third loss to start the season" without a date; week-3/week-4 split boundary is a best-effort inference from that phrasing, not a stated date.
2016 SF: Chip Kelly is on the reputation list as an HC playcaller; article names Curtis Modkins as titled offensive coordinator and never states who actually called plays. Applied reputation rule per instructions.
2017-2026 SF (10 seasons): Kyle Shanahan (SF) is on the reputation list; several season articles list no separate OC title at all (consistent with Shanahan calling plays), but none explicitly states "Shanahan calls the plays." Applied reputation rule per instructions for all ten seasons.
2002-2008 TB (7 seasons): Jon Gruden is on the reputation list; every one of these season articles names a titled offensive coordinator (Bill Muir/Clyde Christensen) but never states who actually called plays. Applied reputation rule per instructions for all seven seasons.
2014 TB: Jeff Tedford's medical leave-of-absence date (Sept 24, 2014) is not in the season article; sourced from Tedford's own Wikipedia bio. Week-3/week-4 split boundary is a best-effort inference from that date.
2026 TB: The archived season article (wiki/2026-TB.txt) does not yet name a new offensive coordinator (only notes "fifth OC in as many seasons"). Fetched Zac Robinson's name from the live Wikipedia article instead. Season had not started as of the current date (Aug 31, 2026), so the OC assignment is provisional.
1999 WAS: No plain "offensive coordinator" title exists in the article; infobox off_coach field names head coach Norv Turner himself, alongside split "Running Game Coordinator" and "Passing Game Coordinator" roles. Treated as HC Turner calling plays based on that infobox field, not the standing-reputation list (Turner is not on it).
2000 WAS: Terry Robiskie was the titled offensive coordinator (pass game coordinator) under Norv Turner, then was promoted to interim head coach after Turner was fired (Dec 4, 2000, 7-6 record). Article does not explicitly state whether Robiskie continued calling plays himself after the promotion; assumed continuity (HC Robiskie for the final weeks). Week-13/week-14 split boundary is a best-effort inference from the "fired Dec 4, 7-6" text, not a game-by-game source.
2002 WAS: Article prose credits Steve Spurrier personally with the "Fun and Gun" offense in his debut season and lists only an "assistant offensive coordinator" (Kim Helton), no plain OC. Treated as HC Spurrier calling plays based on that prose, not the standing-reputation list (Spurrier is not on it).
2003 WAS: Season article is very short and has no coaching-staff section at all (fully silent on OC). Assumed continuity of Steve Spurrier personally calling plays, consistent with 2002 and the "spent only two seasons" framing of his tenure.
2010-2013 WAS (4 seasons): Mike Shanahan (DEN/WAS) is on the reputation list, but all four season articles name his son Kyle Shanahan as the titled offensive coordinator, and real-world sources are genuinely split on whether Kyle or Mike actually called plays in Washington during this stretch. Applied reputation rule per instructions for all four seasons since no season article explicitly contradicts it, but flagging this as the least certain reputation-based call in the whole set.
2012 TEN: Chris Palmer was fired Nov 26, 2012, per an inline article annotation; no game-by-game breakdown given. Week-12/week-13 split boundary is a best-effort inference from that date.

## controller merge fixes

2021 MIA: co-OC pair collapsed to Godsey as primary play-caller; verify who actually called plays.
2022 LV: McDaniels span extended to week 18 (agent used 17-week era length in error).
