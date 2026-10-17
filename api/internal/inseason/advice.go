package inseason

import (
	"fmt"
	"regexp"
	"sort"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
	"github.com/jhunthrop/commish/api/internal/mock"
	"github.com/jhunthrop/commish/api/internal/scoring"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

// MaxWaiverRows is how many waiver rows a page carries.
const MaxWaiverRows = 60

// League is one followed league as the advice reads it.
type League struct {
	Snap leaguesync.Snapshot
	// Me is the drafter's roster.
	Me int
	// Saved is the saved league whose scoring and roster the advice
	// follows, nil when the league's could not be saved (SettingsNote
	// says why, in the league page's words).
	Saved        *apitypes.LeagueSettings
	SettingsNote string
	Board        boards.Board
	// HeldBy is the roster holding each placed player, by board id.
	HeldBy map[string]int
	// Player is a host player as the wire names him.
	Player func(hostID string) apitypes.LeaguePlayer
}

// advisor is one request's league with the week's facts.
type advisor struct {
	League
	settings apitypes.LeagueSettings
	config   []draft.SlotConfig
	slots    []Slot
	season   *Season
	held     map[string]bool
	basis    OrderBasis
	// weeks is how many weeks the order covers (WeeksCovered).
	pages pages
	weeks int
	// gamesLeft is each club's games from the board's first week, the
	// divisor of a row's rest-of-season points a game.
	gamesLeft map[string]int
	// projection is the week's published projection, read in the format
	// the league's scoring is most like (preset).
	projection boards.WeekProjection
	preset     apitypes.ScoringPreset
	now        time.Time
}

// newAdvisor reads the league's roster shape and scoring from the saved
// league and indexes the facts for its week. held is the board ids the
// drafter tags Hold.
func newAdvisor(l League, data Data, projection boards.WeekProjection, held map[string]bool, now time.Time) (*advisor, error) {
	if l.Saved == nil {
		return nil, fmt.Errorf("inseason: the league has no saved settings")
	}
	config, err := mock.SlotConfig(*l.Saved)
	if err != nil {
		return nil, fmt.Errorf("inseason: the saved league's roster: %w", err)
	}
	basis := l.Board.Order
	if basis == "" {
		basis = Preseason
	}
	preset, _ := leaguesync.LeagueScoring(l.Saved, nil, false)
	return &advisor{League: l, settings: *l.Saved, config: config, slots: Slots(config), held: held, basis: basis, weeks: WeeksCovered(basis, firstWeek(l)), pages: newPages(l.Board.Raw), now: now,
		gamesLeft: GamesLeft(data.Games, l.Board.FromWeek), projection: projection, preset: preset,
		season: NewSeason(data, RulesOf(rulesOf(l.Saved.Scoring)), l.Snap.Week, now)}, nil
}

// firstWeek is the first week the order's figures cover: the published
// run's own (published_boards.from_week) on the rest-of-season order,
// and the league's week only while the run does not say.
func firstWeek(l League) int {
	if l.Board.Order == boards.OrderRestOfSeason && l.Board.FromWeek > 0 {
		return l.Board.FromWeek
	}
	return l.Snap.Week
}

// rulesOf is the saved league's scoring as rules: its own, else its
// preset's.
func rulesOf(s apitypes.Scoring) apitypes.ScoringRules {
	if s.Custom != nil {
		return *s.Custom
	}
	preset := apitypes.ScoringPresetPpr
	if s.Preset != nil {
		preset = *s.Preset
	}
	return scoring.PresetRules(preset)
}

// person is one player on a page: how the engine orders him, how the
// wire shows him, and what a sentence knows.
type person struct {
	cand  Candidate
	line  apitypes.PlayerLine
	words Line
}

// build is one player from his wire name: on our board when placed, his
// facts for the week, the host's points this week when his side's
// starter has kicked off.
func (a *advisor) build(id string, lp apitypes.LeaguePlayer, side *leaguesync.Side) person {
	boardID := ""
	if lp.BoardId != nil {
		boardID = *lp.BoardId
	}
	position, team := draft.Position(lp.Position), lp.Team
	bp, placed := a.Board.Player(boardID)
	if placed {
		position, team = bp.Position, bp.Team
	}
	facts := a.season.For(Player{BoardID: boardID, Team: team, Position: position, HostIR: lp.InjuredReserve, ReadAt: a.Snap.ReadAt})
	c := Candidate{ID: id, Position: position, Rank: a.Board.PositionRanks[boardID], Tier: facts.Tier(),
		Locked: facts.Locked, InjuredReserve: facts.InjuredReserve()}
	line := apitypes.PlayerLine{Player: lp, Held: boardID != "" && a.held[boardID], Facts: wireFacts(facts, thisWeek(side, id, facts))}
	words := Line{Name: lp.Name, Position: position, Rank: c.Rank, Facts: facts}
	if c.Rank > 0 {
		rank := c.Rank
		line.PositionRank = &rank
	}
	line.Headshot = faceOf(bp, placed)
	// A club with no game this week (a bye) has no projection, whatever a
	// snapshot says.
	if facts.Opponent != "" {
		line.WeekProjection = a.weekProjection(boardID, position, team)
		line.ProjectionDelta = a.projectionDelta(boardID, position, team)
	}
	if line.WeekProjection != nil {
		// The advice ranks by the tenth the screen prints (Lane 66e).
		c.Proj, c.HasProj = roundTenth(*line.WeekProjection), true
		proj := c.Proj
		words.Proj = &proj
	}
	line.OppRank, line.SeasonAvg, line.LastPoints = evidence(facts)
	if placed {
		// A kicker or defense has no page, so no link (founder ruling 2026-10-17).
		if cardPositions[position] {
			line.Slug = a.pages.of(bp.Name, c.Rank > 0)
		}
		line.RestOfSeasonPerGame = RestOfSeasonPerGame(a.Board, bp, a.gamesLeft)
	}
	if v, ok := a.Board.Values[boardID]; ok {
		c.Value, c.HasValue = v, true
		perWeek := roundTenth(PerWeek(v, a.weeks))
		line.PointsOverReplacement, words.PerWeek = &perWeek, &perWeek
	}
	if facts.PerGame != nil {
		c.PerGame, c.HasPerGame = *facts.PerGame, true
	}
	return person{cand: c, line: line, words: words}
}

// weekProjection is his points on the week's published projection in
// the league's format, to the cent, nil without a row.
func (a *advisor) weekProjection(boardID string, position draft.Position, team string) *float64 {
	p, ok := a.projection.Player(boardID, string(position), team)
	if !ok {
		return nil
	}
	v := roundCents(p.For(a.preset))
	return &v
}

// projectionDelta is his projection's change since the snapshot before,
// to the cent, nil without a row in both.
func (a *advisor) projectionDelta(boardID string, position draft.Position, team string) *float64 {
	d, ok := a.projection.Delta(boardID, string(position), team, a.preset)
	if !ok {
		return nil
	}
	v := roundCents(d)
	return &v
}

// evidence is the season's figures a Lineup row shows beside his
// projection (Lane 66e): his opponent's rank against his position, his
// points a game and his last game's points, each nil without it.
func evidence(f Facts) (oppRank *int, seasonAvg, lastPoints *float64) {
	if f.Allowed != nil && !f.Bye {
		rank := f.Allowed.Rank
		oppRank = &rank
	}
	if f.PerGame != nil {
		avg := roundCents(*f.PerGame)
		seasonAvg = &avg
	}
	if len(f.LastGames) > 0 {
		last := roundCents(f.LastGames[0].Points)
		lastPoints = &last
	}
	return oppRank, seasonAvg, lastPoints
}

// projectionPreviousReadAt is when the snapshot before the week's newest
// was captured, nil with none.
func (a *advisor) projectionPreviousReadAt() *time.Time {
	if a.projection.Previous == nil || a.projection.Previous.ReadAt.IsZero() {
		return nil
	}
	at := a.projection.Previous.ReadAt
	return &at
}

// projectionReadAt is when the week's projection was captured, nil with
// none read.
func (a *advisor) projectionReadAt() *time.Time {
	if a.projection.ReadAt.IsZero() {
		return nil
	}
	at := a.projection.ReadAt
	return &at
}

// givesPlayerPoints is whether the host gives each player's points for the
// side (Sleeper and MFL key every rostered player; ESPN, Yahoo and FFPC
// give the side's total alone, review N1).
func givesPlayerPoints(side *leaguesync.Side) bool {
	return side != nil && len(side.PlayerPoints) > 0
}

// teamPoints is the host's points so far for the side, nil before any of
// the team's starters has kicked off or when its score was not read.
func teamPoints(side *leaguesync.Side, people []person) *float64 {
	if side == nil || side.PointsUnread {
		return nil
	}
	starting := map[string]bool{}
	for _, id := range side.Starters {
		starting[id] = true
	}
	for _, p := range people {
		if starting[p.cand.ID] && p.cand.Locked {
			pts := roundCents(side.Points)
			return &pts
		}
	}
	return nil
}

// thisWeek is the host's points for a starter whose game has kicked off,
// nil where the host gives no player's points.
func thisWeek(side *leaguesync.Side, id string, f Facts) *float64 {
	if side == nil || side.PointsUnread || !f.Locked {
		return nil
	}
	for _, s := range side.Starters {
		if s != id {
			continue
		}
		// A host that gives each side's total and no player's (ESPN, Yahoo,
		// FFPC) leaves his points unknown, never 0 (Lane 66d review H1).
		got, ok := side.PlayerPoints[id]
		if !ok {
			return nil
		}
		pts := roundCents(got)
		return &pts
	}
	return nil
}

func wireFacts(f Facts, pointsThisWeek *float64) apitypes.WeekFacts {
	out := apitypes.WeekFacts{Week: f.Week, Home: f.Home, Kickoff: f.Kickoff, Bye: f.Bye, Played: f.Played,
		PointsThisWeek: pointsThisWeek, LastGames: make([]apitypes.GamePoints, 0, len(f.LastGames))}
	if f.Opponent != "" {
		opp := f.Opponent
		out.Opponent = &opp
	}
	if d := f.Designation; d != nil {
		out.Designation = &apitypes.InjuryDesignation{Status: apitypes.DesignationStatus(d.Status), AsOf: d.AsOf}
	}
	for _, g := range f.LastGames {
		out.LastGames = append(out.LastGames, apitypes.GamePoints{Week: g.Week, Points: g.Points})
	}
	if al := f.Allowed; al != nil {
		out.AllowedToPosition = &apitypes.PointsAllowed{PointsAGame: al.PointsAGame, Rank: al.Rank, Of: al.Of, Position: string(al.Position)}
	}
	c := conditionsOf(f.Game)
	out.GameTotal, out.Spread, out.Roof, out.Weather = c.total, c.spread, c.roof, c.weather
	return out
}

// reserve is the team's players in the host's injured reserve spots, in
// the host's order: on the Lineup screen below the bench, starting nowhere.
func (a *advisor) reserve(t leaguesync.Team, side *leaguesync.Side) []apitypes.PlayerLine {
	out := make([]apitypes.PlayerLine, 0, len(t.Reserve))
	for _, id := range t.Reserve {
		out = append(out, a.build(id, a.Player(id), side).line)
	}
	return out
}

// side is the roster's side of the week's matchup, nil without one.
func (a *advisor) side(roster int) *leaguesync.Side {
	var found *leaguesync.Side
	for i := range a.Snap.Matchups {
		s := &a.Snap.Matchups[i]
		if s.RosterID == roster && (found == nil || (found.Game == 0 && s.Game != 0)) {
			found = s
		}
	}
	return found
}

// active is the team's players who count this week: the injured reserve
// and taxi spots left out.
func (a *advisor) active(t leaguesync.Team) []person {
	away := map[string]bool{}
	for _, id := range append(append([]string(nil), t.Reserve...), t.Taxi...) {
		away[id] = true
	}
	side := a.side(t.RosterID)
	seen := map[string]bool{}
	var out []person
	for _, id := range t.Players {
		if away[id] || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, a.build(id, a.Player(id), side))
	}
	return out
}

// squad is a team's players for the waiver and trade searches, held by
// the drafter's Hold tags when own.
func (a *advisor) squad(people []person, own bool) Squad {
	s := Squad{Players: make([]Candidate, len(people)), Held: map[string]bool{}}
	for i, p := range people {
		s.Players[i] = p.cand
		if own && p.line.Held {
			s.Held[p.cand.ID] = true
		}
	}
	s.Open = len(people) < rosterSpots(a.config)
	return s
}

// rosterSpots is every spot on a roster, starters and bench.
func rosterSpots(config []draft.SlotConfig) int {
	n := 0
	for _, c := range config {
		n += c.Count
	}
	return n
}

// header is what every page carries: the week, the order and the reads.
type header struct {
	week      int
	basis     apitypes.OrderBasis
	refreshed time.Time
	readAt    time.Time
}

func (a *advisor) header() header {
	return header{week: a.Snap.Week, basis: apitypes.OrderBasis(a.basis), refreshed: a.Board.Refreshed, readAt: a.Snap.ReadAt}
}

// host is the host's page for a verb on the member's team, and the note
// a page prints when we cannot open it.
func (a *advisor) host(page Page) (string, *string) {
	href := HostURL(a.Snap.Ref, a.Me, page)
	return href, HostNote(a.Snap.Ref, href)
}

// Lineup is the start and sit page (§4).
func (a *advisor) Lineup() (apitypes.LineupAdvice, bool) {
	team, ok := a.Snap.TeamByRoster(a.Me)
	if !ok {
		return apitypes.LineupAdvice{}, false
	}
	people := a.active(team)
	cands := make([]Candidate, len(people))
	for i, p := range people {
		cands[i] = p.cand
	}
	rows := Lineup(a.config, cands, team.Starters)
	mySide := a.side(a.Me)
	h := a.header()
	// The rows end on the week's projection (Lane 66d), so the basis says
	// nothing of points a game; the page says the projection's read itself.
	out := apitypes.LineupAdvice{Week: h.week, Basis: LineupBasis(a.basis), BasisNote: LineupNote(a.settings, a.season.Carries), OrderBasis: h.basis, Refreshed: h.refreshed,
		ReadAt: h.readAt, ProjectionReadAt: a.projectionReadAt(), ProjectionPreviousReadAt: a.projectionPreviousReadAt(), ProjectionScoring: projectionScoring(a.settings, a.preset), PlayerPoints: givesPlayerPoints(mySide), TeamPoints: teamPoints(mySide, people), Set: true, Slots: []apitypes.LineupSlot{}, EmptySlots: []apitypes.LineupAdviceEmptySlots{}, Bench: []apitypes.PlayerLine{}, Reserve: a.reserve(team, mySide),
		Moves: CopyOnlyMoves(a.Snap.Ref.Host),
	}
	out.HostLineupUrl, out.HostNote = a.host(LineupPage)
	w := &Writer{Basis: a.basis, Now: a.now}
	starting := map[int]bool{}
	for _, r := range rows {
		if r.Ours < 0 {
			// A spot no one who can play fills, empty on the platform too:
			// the screen still shows it (review N2).
			if r.NoOneCanPlay {
				out.EmptySlots = append(out.EmptySlots, apitypes.LineupAdviceEmptySlots(r.Slot.Type))
			}
			continue
		}
		starting[r.Ours] = true
		slot := apitypes.LineupSlot{Slot: apitypes.LineupSlotSlot(r.Slot.Type), Ours: people[r.Ours].line, Changed: r.Changed,
			NoOneCanPlay: r.NoOneCanPlay}
		var host *Line
		if r.Host >= 0 {
			line := people[r.Host].line
			slot.Host, host = &line, &people[r.Host].words
		}
		if r.Changed {
			out.Set = false
			sentence := w.Change(people[r.Ours].words, host)
			slot.Sentence = &sentence
		}
		out.Slots = append(out.Slots, slot)
	}
	var bench []int
	for i := range people {
		if !starting[i] {
			bench = append(bench, i)
		}
	}
	sort.SliceStable(bench, func(i, j int) bool { return acrossBetter(&cands[bench[i]], &cands[bench[j]]) })
	for _, i := range bench {
		out.Bench = append(out.Bench, people[i].line)
	}
	return out, true
}

// starts reports whether the league starts a position in any slot.
func (a *advisor) starts(p draft.Position) bool {
	for _, s := range a.slots {
		if s.accepts(p) {
			return true
		}
	}
	return false
}

// pool is the board's players no roster in the league holds, at the
// positions the league starts, filtered to one position when asked.
func (a *advisor) pool(position draft.Position) []person {
	var out []person
	for _, p := range a.Board.Raw.Players {
		if _, held := a.HeldBy[p.ID]; held || !a.starts(p.Position) || (position != "" && p.Position != position) {
			continue
		}
		id := p.ID
		lp := apitypes.LeaguePlayer{HostId: a.hostIDOfAdd(p), BoardId: &id, Name: p.Name, Position: string(p.Position), Team: p.Team}
		out = append(out, a.build(p.ID, lp, nil))
	}
	return out
}

// espnPlayerID is the shape of an ESPN player id: the board's ids are
// ESPN's own (leaguesync places a rostered player by it), a D/ST's is
// negative.
var espnPlayerID = regexp.MustCompile(`^-?[0-9]{1,12}$`)

// hostIDOfAdd is an unrostered player's id on the league's host, the one
// a claim names: on ESPN his board id, a defense ESPN's D/ST id for its
// club. Empty on any other host, and for a player whose id is not
// ESPN's shape: his Add stays the host's page.
func (a *advisor) hostIDOfAdd(p boards.Player) string {
	if a.Snap.Ref.Host != leaguesync.HostESPN {
		return ""
	}
	if p.Position == draft.DEF {
		id, _ := espn.DefenseID(p.Team)
		return id
	}
	if !espnPlayerID.MatchString(p.ID) {
		return ""
	}
	return p.ID
}

// Waivers is the waiver page (§5).
func (a *advisor) Waivers(position draft.Position) (apitypes.WaiverAdvice, bool) {
	team, ok := a.Snap.TeamByRoster(a.Me)
	if !ok {
		return apitypes.WaiverAdvice{}, false
	}
	mine := a.active(team)
	squad := a.squad(mine, true)
	pool := a.pool(position)
	cands := make([]Candidate, len(pool))
	for i, p := range pool {
		cands[i] = p.cand
	}
	h := a.header()
	out := apitypes.WaiverAdvice{Week: h.week, Basis: WaiversBasis(a.basis), SeasonBasis: withRestOfSeason(a.Board, WaiverSeasonBasis(a.basis, a.weeks), mine, pool),
		BasisNote: BasisNote(a.settings, a.season.Carries), OrderBasis: h.basis, Refreshed: h.refreshed, ReadAt: h.readAt,
		ProjectionReadAt: a.projectionReadAt(), ProjectionPreviousReadAt: a.projectionPreviousReadAt(), ProjectionScoring: projectionScoring(a.settings, a.preset),
		Pickups: []apitypes.WaiverRow{}, Rows: []apitypes.WaiverRow{}, Roster: lines(mine, indexes(len(mine))), Moves: CopyOnlyClaims(a.Snap.Ref.Host)}
	out.HostWaiversUrl, out.HostNote = a.host(WaiversPage)
	week := newPickupWeek(a.config, squad.Players, team.Starters)
	clears := a.clearsOf()
	w := &Writer{Basis: a.basis, Now: a.now}
	moves := Waivers(a.config, a.weeks, squad, cands)
	for _, move := range moves {
		if len(out.Rows) == MaxWaiverRows {
			break
		}
		out.Rows = append(out.Rows, waiverRow(w, week, mine, pool[move.Add], move, clears))
	}
	// The strip is chosen from every add we rank, before the rows' cut.
	var proj float64
	out.Pickups, proj = a.strip(w, week, mine, pool, moves, clears)
	if out.ProjectionReadAt != nil {
		base := week.base.proj
		out.LineupProj, out.PickupsProj = &base, &proj
	}
	return out, true
}

// waiverRow is one add's row: the rest-of-season gain with the search's
// drop, this week's on the Lineup screen's rule, whom he beats (or the
// open spot he fills), every drop he could take with its gains, and the
// day a claim on him clears.
func waiverRow(w *Writer, week *pickupWeek, mine []person, add person, move Waiver, clears map[string]openapi_types.Date) apitypes.WaiverRow {
	row := apitypes.WaiverRow{Add: add.line, Gain: roundTenth(move.Gain), Beats: week.beats(add.cand, mine), Drops: []apitypes.WaiverDrop{}}
	if !move.NoDrop {
		var open bool
		row.WeekGain, row.Starts, open = week.with(add.cand, move.Drop)
		if open {
			row.Beats = openSpot(row.WeekGain)
		}
	}
	var drop *Line
	if move.Drop >= 0 {
		line := mine[move.Drop].line
		row.Drop, drop = &line, &mine[move.Drop].words
	}
	for _, d := range move.Drops {
		weekGain, _, _ := week.with(add.cand, d.At)
		row.Drops = append(row.Drops, apitypes.WaiverDrop{HostId: mine[d.At].cand.ID, Gain: roundTenth(d.Gain), WeekGain: weekGain})
	}
	row.Pickup = !move.NoDrop && isPickup(row)
	if day, ok := clears[add.cand.ID]; ok {
		row.Clears = &day
	}
	// The sentence says he starts only when he starts this week.
	move.Starts = row.Starts
	row.Sentence = w.Waiver(add.words, drop, move)
	return row
}

// indexes is 0 through n-1.
func indexes(n int) []int {
	out := make([]int, n)
	for i := range out {
		out[i] = i
	}
	return out
}

// Trades is the trade finder (§6). focus is a host id, "" for none.
func (a *advisor) Trades(focus string) (apitypes.TradeAdvice, bool) {
	team, ok := a.Snap.TeamByRoster(a.Me)
	if !ok {
		return apitypes.TradeAdvice{}, false
	}
	mine := a.active(team)
	squad := a.squad(mine, true)
	h := a.header()
	out := apitypes.TradeAdvice{Week: h.week, BasisNote: BasisNote(a.settings, a.season.Carries), OrderBasis: h.basis, Refreshed: h.refreshed,
		ReadAt: h.readAt, Teams: []apitypes.TradeTeam{}, Roster: rosterLines(mine), Moves: TradeMoves(a.Snap.Ref.Host),
		ProjectionReadAt: a.projectionReadAt(), ProjectionScoring: projectionScoring(a.settings, a.preset), PlayerPoints: givesPlayerPoints(a.side(a.Me))}
	out.HostTradesUrl, out.HostNote = a.host(TradesPage)
	// Every roster the screen and its builder show, for the basis.
	shown := [][]person{mine}
	for _, t := range leaguesync.Standings(a.Snap.Teams) {
		if t.RosterID == a.Me {
			continue
		}
		theirs := a.active(t)
		shown = append(shown, theirs)
		row := apitypes.TradeTeam{RosterId: t.RosterID, Name: t.Name, Owner: t.Owner,
			Record: apitypes.TradeRecord{Wins: t.Wins, Losses: t.Losses, Ties: t.Ties}, Roster: rosterLines(theirs), Trades: []apitypes.TradeRow{}}
		close := 0
		for _, tr := range Trades(a.config, a.weeks, squad, a.squad(theirs, false), focus, TradesPerTeam) {
			row.Trades = append(row.Trades, a.tradeRow(mine, theirs, tr, a.tradeWeek(team, t, mine, theirs, tr)))
			if tr.CloseForThem() {
				close++
			}
		}
		if close > 0 && close == len(row.Trades) {
			note := OnlyCloseCalls
			row.Note = &note
		}
		out.Teams = append(out.Teams, row)
	}
	out.Basis = withPerGame(a.Board, TradesBasis(a.basis, a.weeks), shown...)
	out.CheckBasis = withPerGame(a.Board, TradeCheckBasis(a.basis, a.weeks), shown...)
	return out, true
}

// positionOrder is the order the trade picker lists a roster in.
var positionOrder = map[draft.Position]int{draft.QB: 0, draft.RB: 1, draft.WR: 2, draft.TE: 3, draft.K: 4, draft.DEF: 5}

// rosterLines is every active player on the roster, by position then name.
func rosterLines(people []person) []apitypes.PlayerLine {
	out := make([]apitypes.PlayerLine, len(people))
	for i, p := range people {
		out[i] = p.line
	}
	rank := func(l apitypes.PlayerLine) int {
		if r, ok := positionOrder[draft.Position(l.Player.Position)]; ok {
			return r
		}
		return len(positionOrder)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if ri, rj := rank(out[i]), rank(out[j]); ri != rj {
			return ri < rj
		}
		return out[i].Player.Name < out[j].Player.Name
	})
	return out
}

func lines(people []person, at []int) []apitypes.PlayerLine {
	out := make([]apitypes.PlayerLine, len(at))
	for i, p := range at {
		out[i] = people[p].line
	}
	return out
}

// hostIDOf is the rostered player with the board id, "" when no roster
// in the league holds him.
func (a *advisor) hostIDOf(boardID string) string {
	for _, t := range a.Snap.Teams {
		for _, id := range t.Players {
			if lp := a.Player(id); lp.BoardId != nil && *lp.BoardId == boardID {
				return id
			}
		}
	}
	return ""
}
