# Lane 66k mock: the front door in season and the Account room

**Front door, signed in.** The League page's score bug leads the page, and it opens the Matchup. Its head reads "Week 6, Next kickoff Sun 8:30 am", and its foot names who plays first: Meyers, HOU at JAX, abroad. Beside it sits the Lineup's decision strip: "Three changes, +26.9", with the three swaps (Dart for Rodgers, Etienne for Chase, Texans for Vikings) and one verb, Set your lineup. On the phone that verb is pinned. Under them, three chips cover his roster: Odunze Questionable (opens Lineup), LaPorta on bye with no TE of his playing (opens Waivers), and the top pickup Hutchinson at +1.8 a week (opens Waivers). Below that, the board's top eight sit on the left. On the right are Your leagues, read from /me, and Our record. The basis runs three lines at 1440 and six at 390.

**Account room.** One settings table per section:
- Platforms: connection, consent version, Lineups on or off with the reason, and last read. The verb is Connect, Disconnect, or, where FFPC signed him out, the one solid verb Sign in again.
- Leagues attached: record, place, season, last read, and Open.
- Plan, Display (theme, plus the time zone from the device), Next draft, Devices.

**What the API needs before the build:**
- `HostConnection` needs `consent_version`, `writes_on` and `writes_reason`.
- `AttachedLeague` needs `last_read_at`.
- The Sleeper row is a fixed fact, since `ConnectedHost` has no Sleeper.
- The front door reads the scoreboard, lineup and waivers. One summary route may suit its budget better.

The visitor front door is unchanged and was not mocked.
