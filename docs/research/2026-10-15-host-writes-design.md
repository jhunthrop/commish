# How a move is made on each host with the member's session (Lane 34 spike)

Date: 2026-10-15. Read-only research: public sources and the repository's own clients only. No sign-in, no credential, no live request was made by this spike. Founder ruling 2026-10-15: "we will do writes if we can, if we can't it is what it is. Yahoo doesn't have a write permission." Spec context: `docs/superpowers/specs/2026-10-15-in-season-tools-design.md` §10.2 (today's text, line 35 and line 214, still says "we never write a host"; this doc is the input to changing it).

Tags: **[captured]** means a third party recorded the request against the live host and published it; **[bundle]** means read from ESPN's own public JavaScript; **[inferred]** is ours. Third-party captures are not ESPN documentation: ESPN has none for writes.

## 0. Summary

| Host | Write path | Verdict | Verb |
|---|---|---|---|
| ESPN | JSON POST to `lm-api-writes`, one endpoint for lineup, claim, drop, trade; captured live, 200 and typed 409s | Feasible. Build first. | Writes, behind a switch |
| FFPC | Server-rendered ASP.NET WebForms postbacks on the pages we already read | Feasible but fragile, nothing public to copy; must be proven by capture | Writes only after capture; link until then |
| MyFantasyLeague | Documented import API (`/import?TYPE=lineup`, waivers, trades) | Feasible and the only documented one; needs the member's login cookie, which we do not store today | Writes after a credential decision |
| Yahoo | Write API exists in the guide, but Yahoo says write access is unavailable | No write permission. Not researched further. | Stays a link |
| Sleeper | Public API is read-only | No write API. | Stays a link |

## 1. ESPN (depth)

### 1.1 Endpoint

One host and one path carry every write:

`POST https://lm-api-writes.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}/segments/0/leagues/{leagueId}/transactions/`

- Source for host, path, trailing slash, headers: ESPN's own bundle review at [krmisystems ESPN_HTTP_COMPATIBILITY.md](https://github.com/krmisystems/fantasy-football-manager/blob/main/docs/ESPN_HTTP_COMPATIBILITY.md) (lines 109-118, **[bundle]**), and live captures in [jwulff 05-espn-write-surface.md §1.1](https://github.com/jwulff/fantasy-sports/blob/main/docs/research/05-espn-write-surface.md) (**[captured]**, 2026-09-12). Our read host is `lm-api-reads` (`api/internal/espn/client.go:27`); writes are a different host, GET on it answers 405.
- ESPN's web app sends `Content-Type: application/json`, `X-Fantasy-Source: kona`, `X-Fantasy-Platform` (kona-PROD in the capture, espn-fantasy-web in the bundle review) and a `platformVersion` query value (compat lines 117-118; [piercetalbert capture notes](https://github.com/piercetalbert/espn-ai-manager/blob/main/CAPTURE_ESPN_WRITES.md) say it is a web-build hash that may be needed for trades, unconfirmed).
- Sent by a plain Python client with a `python-requests` User-Agent and only `Content-Type: application/json`: accepted (jwulff 05 §2.2, p4 and p15r). So the two `X-Fantasy-*` headers and `platformVersion` are optional for a lineup write; we should still send ESPN's two headers and our own User-Agent for parity (**inferred** as harmless).

### 1.2 What the session needs

- Cookie `espn_s2` is the session. Captured: `espn_s2` alone returned 200 EXECUTED; `SWID` alone, or a bad `espn_s2` with a good `SWID`, returned 401 `AUTH_MISSING_CREDENTIALS`; body `memberId` (the SWID) is optional (jwulff 05 §6.3 table, p10, p13-p15).
- No CSRF token was found or needed (same capture set; none appears in the bundle review's header list, compat line 117).
- We already hold both cookies: `espn.Cookies{SWID, S2}` and the `Cookie: SWID=...; espn_s2=...` header (`api/internal/espn/league.go:40-60`), sent on reads at `league.go:240`, with the member's team found by SWID against `owners` (`api/internal/leaguesync/espnhost.go:99-117`). A write client reuses `Cookies.header()`; no new credential.
- The cookie carries the member's authority: a commissioner's cookie wrote another manager's lineup (jwulff 05 §6.1, p12). Whether an ordinary member's cookie is refused on a foreign team is **unverified**. Our guard must be client side: refuse any `teamId` not in the SWID's own `owners` set (jwulff 05 §6.2).

### 1.3 Request shapes

All bodies carry `isLeagueManager: false`, `teamId`, `scoringPeriodId`, `executionType: "EXECUTE"`, optional `memberId` (compat lines 120-123; jwulff 05 §2.1).

**Lineup set** [captured, jwulff 05 §2.1, p3; bundle compat line 127]. Outer `type: "ROSTER"`, items `{playerId, type: "LINEUP", fromLineupSlotId, toLineupSlotId}`. One player into a slot and another out is a swap, two items in one POST:

```json
{"isLeagueManager":false,"teamId":1,"type":"ROSTER","scoringPeriodId":1,"executionType":"EXECUTE",
 "items":[{"playerId":111,"type":"LINEUP","fromLineupSlotId":20,"toLineupSlotId":4},
          {"playerId":222,"type":"LINEUP","fromLineupSlotId":4,"toLineupSlotId":20}]}
```

- Wire names are `fromLineupSlotId`/`toLineupSlotId`; the internal `fromSlotId` names 400 ([heyitaki transactions.ts](https://github.com/heyitaki/espn-fantasy-football-mcp/blob/main/src/espn/transactions.ts) lines 9-34 builds exactly this; the 400 note is from a search summary of a third-party MCP, **unconfirmed**).
- Football slot ids: 20 bench, 21 IR (compat line 137); our map is `api/internal/espn/league.go:73-87`, and the roster already reads `lineupSlotId` per entry (`league.go:144,328`) and `lineupSlotCounts` (`league.go:162,283`). Legal targets are the player's `eligibleSlots` (jwulff 05 §2.1).
- One POST is atomic: any rejected item rejects the whole transaction (jwulff 05 §3, p7, p9). Send only slots that change; a from==to item is rejected whole (`TRAN_ROSTER_SAME_SLOT`).
- `scoringPeriodId` must be the league's current period; next week answers 409 `TRAN_INVALID_SCORINGPERIOD_NOT_CURRENT` (jwulff 05 §4, p11). The bundle shows `FUTURE_ROSTER` for later periods (compat lines 128, 139-140); that is **bundle only, never exercised**, so v1 sets the current week only.

**Waiver claim with its drop, and FAAB bid** [captured, jwulff 06 §1, p4]. Outer `type: "WAIVER"`, one `ADD {playerId, toTeamId}` plus `DROP {playerId, fromTeamId}`:

```json
{"isLeagueManager":false,"teamId":7,"type":"WAIVER","scoringPeriodId":6,"executionType":"EXECUTE",
 "items":[{"playerId":30,"type":"ADD","toTeamId":7},{"playerId":23,"type":"DROP","fromTeamId":7}]}
```

- Source: [jwulff 06-espn-add-drop-surface.md §0-§1](https://github.com/jwulff/fantasy-sports/blob/main/docs/research/06-espn-add-drop-surface.md) (captured 2026-10-15 in a throwaway public league; claims went `PENDING` and were cancelled, nothing executed). Missing `toTeamId` or `fromTeamId` answers 409 `TRAN_ITEM_TO_TEAM_ID_MISSING` / `TRAN_ITEM_FROM_TEAM_ID_MISSING`.
- FAAB: add `bidAmount` to the body (compat line 143, **[bundle]**; heyitaki `waiverPayload` line 50 sends it). In a league without FAAB any `bidAmount` answers 409 `TRAN_ACQUISITION_BUDGET_NOT_SUPPORTED` (jwulff 06 §0 row 9), so omit it unless `settings.acquisitionSettings.isUsingAcquisitionBudget` is true. Bid bounds from the bundle: `minimumBid` and `acquisitionBudget - acquisitionBudgetSpent` (compat line 145). A budget-exceeded refusal was **not observed**.
- Success answer: 200, `status: "PENDING"`, `isPending: true`, a server `id`, roster unchanged until the league processes waivers (jwulff 06 §1).
- A player on waivers must go as `WAIVER`; a `FREEAGENT` add of a waiver player answers 409 `TRAN_PLAYER_NOT_FREEAGENT`. A free agent goes as `FREEAGENT` with the same items (compat lines 129-131); an executing `FREEAGENT` add/drop was verified live by a third-party tool ([compat lines 202-206](https://github.com/krmisystems/fantasy-football-manager/blob/main/docs/ESPN_HTTP_COMPATIBILITY.md)) but its raw capture is not published. Roster full with no drop: 409 `TRAN_ROSTER_LIMIT_EXCEEDED_ONE`, "Too many players on roster (maximum 16)." with a resolution sentence (jwulff 06 §0 row 6).
- Cancel: `type: "WAIVER"`, `executionType: "CANCEL"`, `relatedTransactionId` (jwulff 06 §2; heyitaki lines 53-60). A cancelled claim still reads `PENDING` in `mTransactions2`; read the queue from `view=mPendingTransactions` (jwulff 06 §2).

**Trade offer** [captured by one source only]. The sole shape found is in [piercetalbert CAPTURE_ESPN_WRITES.md](https://github.com/piercetalbert/espn-ai-manager/blob/main/CAPTURE_ESPN_WRITES.md): `type: "TRADE_PROPOSAL"`, items `{playerId, type: "TRADE", fromTeamId, toTeamId}` for each side, plus `expirationDate` and `comment`. Another plan lists the type names `TRADE_PROPOSE`, `TRADE_ACCEPT`, `TRADE_REJECT` as "well attested" but unverified ([sportsdata-mcp ESPN-WRITES-PLAN.md](https://github.com/DanielTomaro13/sportsdata-mcp/blob/main/docs/ESPN-WRITES-PLAN.md) lines 65-69). The two disagree on the type name. **Trade is the least proven ESPN shape; prove it by one capture before build.** A trade offer messages another human and cannot be unsent by us.

### 1.4 Answers on refusal

All roster-rule refusals are HTTP 409 with `messages[]` prose and `details[0].type` (jwulff 05 §5.1, 06 §4). Observed types: `TRAN_LINEUP_LOCKED` ("Lineup transaction could not be completed, <player> is locked"), `TRAN_ROSTER_SLOT_LIMIT_EXCEEDED`, `TRAN_ROSTER_SAME_SLOT`, `TRAN_INVALID_SCORINGPERIOD_NOT_CURRENT`, `TRAN_PLAYER_NOT_FREEAGENT`, `TRAN_PLAYER_NOT_AVAILABLE`, `TRAN_PLAYER_NOT_ON_TEAM`, `TRAN_ROSTER_LIMIT_EXCEEDED_ONE`, `TRAN_ACQUISITION_BUDGET_NOT_SUPPORTED`. A 401 `AUTH_MISSING_CREDENTIALS` cannot tell expired from absent; do not map it to "sign in again" when a read on the same cookie just succeeded (jwulff 05 §5.1). 400 with no `details` is a malformed body, our bug. The bundle's failure status list (compat lines 176-178) adds `FAILED_LINEUPLOCK`, `FAILED_ROSTERLOCK`, `FAILED_IRSLOT`, `FAILED_UNDROPPABLEPLAYER`, `FAILED_MATCHUPACQUISITIONLIMIT`, `FAILED_MINIMUMBID`, which appear in processed claims, not at submit. Surfacing: show ESPN's `messages[0]` verbatim, prefixed by "ESPN said:" (see §6).

Pre-flight from data we already read: `lineupLocked`, `rosterLocked`, `tradeLocked`, `droppable` on `playerPoolEntry` (compat lines 152-157), status FREEAGENT vs WAIVERS (jwulff 06 §7). No idempotency key exists, no dry run exists (`executionType: "VALIDATE"` answers 400; jwulff 05 §2.2). A lost response is not a failed write; read back before any retry (jwulff 05 §8 item 1; compat lines 174-179).

### 1.5 Risks

- Terms: ESPN is covered by Disney's general terms, whose translated text bars access "through a robot, web spider, scraping or other automated means" without written permission (search summary of [disneytermsofuse.com](https://disneytermsofuse.com/app/uploads/2020/09/disney_gtou_20160331v2_Spanish-Latin-American-TOU.pdf); a third-party tracker reports the same clause in the current Disney+ terms, [Conduct Atlas](https://conductatlas.com/platform/disney/disney-terms-of-use/provision/CA-P-022520/prohibition-on-automated-access-and-ai-scraping/)). A human-confirmed single move sent with the member's own cookie is not bulk automation, but it is a request from a server, not their browser. That is a terms exposure to put to counsel, not a technical block.
- Account consequence: one community README warns "ESPN may ban accounts engaging in automated write operations" ([pseudo-r README](https://github.com/pseudo-r/Public-ESPN-Fantasy-API/blob/main/README.md), line 378). No reported ban for a low-volume write was found. **Not verified.**
- Rate limits: 21 writes in six minutes and 13 more later produced no 429 or throttling header (jwulff 05 §8 item 2, 06 §0). Unknown under burst; do not probe. Our reads already pace at 250 ms (`api/internal/espn/client.go:32`).
- Write visibility: every write is a permanent, member-attributed row in the league's transaction log (jwulff 05 §6.2). Other managers see it.
- Shape drift: undocumented; the host can change without notice. Typed 400s make drift loud.

## 2. FFPC (depth)

No public library or write documentation exists for myffpc.com; the only evidence is our own captured pages and client. Everything below about request shape is **inferred** until a capture proves it.

- Session: sign-in posts the ASP.NET form at `/account/Login.aspx` with hidden fields and `txtExistingUsername`, `txtExistingPassword`, `btnSignIn=SIGN IN` (`api/internal/hosts/ffpc/client.go:210-217`, `signinform.go:9-53`). The returned cookies are kept whole and sent back (`client.go:93-105,145-170`); the fixture names them `BGSLMSession` and `BGSLMAuthenticated` (`testdata/README.md`). The stored sign-in therefore re-creates a session; there is no separate form token beyond ASP.NET's per-page `__VIEWSTATE`, `__EVENTVALIDATION` fields, which must be read from the page just before each post (as `OpenLeague` does, `client.go:215-257`).
- Lineup: `/SetLineup.aspx?ltuid=...` (`pages.go:26`). The fixture shows each row has a `ddlActions` select with options "[Select Action]", "Move to Bench" and "Swap with <player>" (`testdata/ffpc-team-lineup.html`, names `...rptStartingLineup$ctlNN$ddlActions`), plus IR buttons `btnConfirmMoveToIR` and `btnConfirmTerminatePlayer`. **Inferred**: a lineup move is a postback of the page's form with that select set to the option text and the hidden state echoed; the page's scripts and event attributes were stripped from the fixture, so the autopostback target is unknown.
- Free agents: `/FreeAgents.aspx` rows have an Add link that is `__doPostBack('...grdFreeAgents$ctlNN$btnAddPlayer','')` (`testdata/ffpc-free-agents.html`). FFPC's blind bids use "bid groups" (`aBidGroupsGlobal` on the lineup page). The claim-with-drop and bid flow is a multi-step modal; its form is **unknown**.
- Trade: nothing captured.
- Answers on success or refusal: unknown; FFPC pages render messages in HTML, so refusal text is scraped, not typed.
- Risks: FFPC's terms of use could not be found by search; **not verified**. The site also calls `https://api.myffpc.com/api/` with a bearer minted by its own JavaScript (`testdata/README.md`), a second surface that is undiscovered. Pace today is one request a second process-wide (`client.go:36`); a write adds 2 to 3 page loads (GET page for state, POST, GET to confirm).
- Our client states in a comment that it never sets a lineup (`client.go:23-26`); that guarantee would change and its tests with it.
- Verdict: feasible in principle (the member's own session performs the same form posts a browser does), but with no reference, ViewState coupling and no typed errors it is the most fragile of the three buildable hosts. Build only after a founder-owned capture (§5). Until then the FFPC verb stays a link.

## 3. MyFantasyLeague (depth)

Documented, per [MFL API info](https://api.myfantasyleague.com/2024/api_info): URL `protocol://host/{year}/import?TYPE=...`, XML-bearing imports via POST. Our client reads the export side only (`api/internal/mfl/client.go:34,225-250`, one request a second per server at `:43`).

| Move | Import `TYPE` and parameters (MFL docs) |
|---|---|
| Lineup | `lineup`: `L`, `W`, `STARTERS` (list of player ids), `COMMENTS`, `FRANCHISE_ID` |
| Claim, first-come | `fcfsWaiver`: `L`, `ADD`, `DROP` (comma lists) |
| Claim, priority | `waiverRequest`: `L`, `ROUND`, `PICKS` as `addID_dropID`, in priority order |
| Claim, FAAB | `blindBidWaiverRequest`: `L`, `PICKS` as `playerID_amount_dropID` ("0000" for no drop) |
| Trade offer | `tradeProposal`: `L`, `OFFEREDTO`, `WILL_GIVE_UP`, `WILL_RECEIVE`, `COMMENTS`, `EXPIRES` |

- Auth: log in with `TYPE=login` (`USERNAME`, `PASSWORD`, `XML=1`, over HTTPS, POST) and send the returned value as `Cookie: MFL_USER_ID=...`. The `APIKEY` parameter works for exports only, not imports (MFL API info, "Authentication"). So a write needs the member's login cookie: a credential we do not store today (the MFL host is public-read only; `api/internal/leaguesync/mflhost.go:15-26`). That is a product decision for the founder (store the password as FFPC does, or ask for a cookie).
- Success and refusal text, and per-type error codes: not on the public page. **Unknown**; MFL's own error string reads like "An error has occurred" for bad parameters (`api/internal/mfl/client.go:171-173`). Prove by capture.
- Risks: MFL requires a registered client and sends 429 on excess, asks for about one second between requests and no retries. It names "changing someone's team without permission" and "circumventing league rules" as forbidden, reserves action against abuse, and says past permission does not guarantee future access (MFL API info, "Bans and Enforcement"). A move the member confirmed is permitted use by that text; our commercial scale is a question for MFL (**inferred**).
- Verdict: the cleanest write path of any host (documented, plain parameters). Gated on the credential decision.

## 4. Yahoo and Sleeper (one line each)

- Yahoo: no write permission; Yahoo's access form says the API "currently provides read access only" ([sports.yahoo.com/developer/access](https://sports.yahoo.com/developer/access/)). The verb stays a link; no write scope or re-registration is pursued.
- Sleeper: the documented API is read-only, "you cannot modify contents via this API" ([docs.sleeper.com](https://docs.sleeper.com/)); there is no write API and the verb stays a link.

## 5. The proof plan

Applies per host before its switch turns on. All on a league the founder owns, with a throwaway league per host if the host allows one, never on a league with other members.

1. **Capture before code.** The founder performs the move in the host's own web page with the browser devtools network tab open and shares the method, URL and body shape with values replaced by types; no cookie leaves the machine (the approach in sportsdata-mcp plan, Phase B). ESPN lineup and claim shapes already have third-party captures; ESPN trade, FFPC and MFL do not.
2. **ESPN lineup**: in the founder's league, before Sunday kickoffs, swap two unlocked, mutually eligible players (one bench, one starter), then swap back. Record: request body, status, response JSON including `id` and `status`, a fresh `mRoster` read, and the host's SetLineup page. Then provoke one refusal safely: send a move including a locked player after his game (expect 409 `TRAN_LINEUP_LOCKED`), which is atomic and applies nothing.
3. **ESPN claim**: in a throwaway league, a bidless `WAIVER` claim with a drop, read it in `mPendingTransactions`, cancel it with `CANCEL`. FAAB: a throwaway league with `isUsingAcquisitionBudget` true, one bid at `minimumBid`, cancel; then bid above budget to record the refusal. Never in a real league: even a rejected claim can be visible to others (jwulff 05 §5.2).
4. **ESPN trade**: two accounts in a throwaway league, offer one player for one, revoke. Record the exact `type` string.
5. **FFPC**: in a founder league, one capture of a lineup swap (page HTML before and after, posted form fields), then replay by our client with a swap and its reverse.
6. **MFL**: a founder league, `import?TYPE=lineup` for the founder's franchise, then restore; record the XML or text answer for success and for a locked player.
7. For each: keep the sent body, the response and the host's page after, in the proof record; surface refusals as the host's words (§6). A host's switch turns on only when the proof record shows one success, its reversal, and one captured refusal.

## 6. Recommendation

**Build order**: (1) ESPN lineup set, (2) ESPN waiver claim with drop, plus FAAB bid, (3) MFL lineup and claims once the credential decision is made, (4) FFPC after capture, (5) ESPN trade offer last, because its shape has one source and it messages a person. Yahoo and Sleeper stay links.

**Confirmation screen words**. One verb, the exact move stated, the host named as the mechanism, no tips:

- Lineup: heading "Start Rachaad White over Tank Bigsby at RB2"; button "Set it on ESPN".
- Claim: "Add Jauan Jennings, drop Josh Downs, bid $12"; button "Claim on ESPN". Without FAAB: "Add Jauan Jennings, drop Josh Downs"; same button.
- Trade: "Offer Josh Downs for Rashee Rice to the Hail Marys"; button "Offer on ESPN".
- After a success: "Done on ESPN. Your lineup there now reads ..." from a fresh read. A claim says "Claim in. ESPN processes it Thursday." because it is `PENDING`.
- On refusal: "ESPN said: <message verbatim>." and the link verb "Open ESPN" beside it. Never a retry button.
- No em-dashes, no competitor names, no market words (per the copy rules in memory).

**Per-host switches**: one flag per host and per move kind, default off: `host_write_espn_lineup`, `host_write_espn_claim`, `host_write_espn_trade`, `host_write_ffpc_lineup`, `host_write_mfl_lineup`, and so on. A switch is turned on only when the proof record exists. When off, or when a host has no write path, the same screen shows the link verb ("Open ESPN lineup") exactly as the spec says today, so one screen serves both modes.

**Contract**: one route so the web client has one call for every host:

`POST /api/leagues/{leagueId}/host-moves` with body `{ "kind": "lineup"|"claim"|"trade", "week": n, "items": [...], "confirm": "<token>" }` and these rules:

- Two steps in one contract: a first call without `confirm` returns `{ "plan": {sentence, host, items, read_at}, "confirm": "<token>" }` computed from a fresh host read (lock, droppable, FAAB bounds, slot eligibility all checked there); a second call with the token executes. This is the only write; nothing writes on a read route.
- Items are host neutral: lineup `{player, from_slot, to_slot}`, claim `{add, drop?, bid?}`, trade `{give[], get[], to_team, expires?}`. The adapter per host maps to ESPN items, an FFPC postback, or an MFL import.
- Answer: `{ "outcome": "done"|"pending"|"refused"|"uncertain", "host_words": string|null, "host_ref": id|null, "read_back": {...} }`. `refused` carries the host's message verbatim and applies nothing (ESPN is atomic per POST). `uncertain` is for a lost response: no retry until a read settles it. 409 for refusal, 422 for a move we refuse before sending (not the member's team, the week not current, a bid in a non-FAAB league), 501 with `{ "link": url }` for a host or kind with its switch off or no write path, so the client falls back to the link verb.
- Guards in the adapter: team must be the session's own (SWID in `owners`), one move per confirm, a per-account cap of a few writes a minute, a write journal row (plan, host id, outcome) before send and after, and no automatic retry.
- Credentials never appear in plan, answer or logs (the existing redacting types: `espn/league.go:46-47`).

## 7. Open questions for the founder or counsel

1. Disney terms and a server-sent write on a member's cookie: acceptable exposure? (§1.5)
2. MFL: store the password, as FFPC does, to be able to write?
3. ESPN `X-Fantasy-Platform` value and `platformVersion` on trades need the one capture in §5.
