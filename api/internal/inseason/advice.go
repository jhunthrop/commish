package inseason

import (
	"context"
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
	// weeks is how many weeks the order covers (WeeksCovered), through
	// the league's horizon (HorizonOf, Lane 96).
	pages   pages
	weeks   int
	horizon Horizon
	// rest is the rest of season at the read's clock (Lane 86), whose
	// board League.Board is; gamesLeft its clubs' games still to play, the
	// divisor of a row's rest-of-season points a game.
	rest      RestNow
	gamesLeft map[string]int
	// projection is the week's published projection, read in the format
	// the league's scoring is most like (preset).
	projection boards.WeekProjection
	preset     apitypes.ScoringPreset
	now        time.Time
	// week is the week the advisor's facts and projection are for: the
	// league's (Snap.Week), or the week after on an action screen once the
	// member's lineup has played its week (Lane 95, turnTo).
	week int
	// playing is the read's playing-first position ranks (playingRanks),
	// computed once.
	playing map[string]int
	// free is the read's waiver levels (levels), computed once.
	free *freeLevels
	// data is the season's facts the Season indexes, kept for turnTo.
	data Data
	// platform is the league platform's points for its week (Lane 111),
	// kept for turnTo.
	platform PlatformWeek
	// finds is the league read's trades with each team, searched once per
	// read across requests (Service.findsFor); nil searches for this
	// advisor alone, once (found).
	finds     func() (map[int][]Trade, error)
	foundHere map[int][]Trade
	// searchErr is a search that stopped (shutdown, its deadline): the
	// routes answer it as ErrSearchStopped, never as no trades (rereview
	// 66u F2).
	searchErr error
}

// found is every trade the finder keeps with each other team, by roster
// id, in orderTrades' order: the Trades screen and the order's targets
// both read it (Lane 66u N3). A search that stopped answers nothing and
// leaves its error in searchErr.
func (a *advisor) found() map[int][]Trade {
	if a.finds != nil {
		got, err := a.finds()
		if err != nil {
			a.searchErr = err
		}
		return got
	}
	if a.foundHere == nil {
		// An advisor with no service (the package's own tests) searches on
		// a context nothing cancels, so findAll cannot stop.
		found, err := a.findAll(context.Background())
		if err != nil {
			a.searchErr = err
		}
		a.foundHere = found
	}
	return a.foundHere
}

// findAll is the search found keeps: the drafter's squad against every
// other team's. Empty when the drafter's team is not in the read. ctx
// stops the search between teams (rereview 66u W3): a stopped search
// answers ctx's error and nothing to keep.
func (a *advisor) findAll(ctx context.Context) (map[int][]Trade, error) {
	out := map[int][]Trade{}
	team, ok := a.Snap.TeamByRoster(a.Me)
	if !ok {
		return out, nil
	}
	squad := a.squad(team, a.active(team), true)
	for _, t := range a.Snap.Teams {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if t.RosterID != a.Me {
			out[t.RosterID] = AllTrades(a.config, a.weeks, squad, a.squad(t, a.active(t), false))
		}
	}
	return out, nil
}

// newAdvisor reads the league's roster shape and scoring from the saved
// league and indexes the facts for its week. held is the board ids the
// drafter tags Hold. lives keeps the board at the read's clock across
// requests (nil builds it afresh).
func newAdvisor(l League, data Data, projection boards.WeekProjection, held map[string]bool, now time.Time, lives *LiveBoards) (*advisor, error) {
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
	platform := platformWeekOf(l)
	horizon := HorizonOf(l.Snap.Terms).Reaching(l.Board.FromWeek)
	var rest RestNow
	if l.Board, rest, err = lives.At(l.Board, data.Games, horizon, now); err != nil {
		return nil, fmt.Errorf("inseason: the board at the read's clock: %w", err)
	}
	return &advisor{rest: rest, League: l, settings: *l.Saved, config: config, slots: Slots(config), held: held, basis: basis, horizon: horizon, weeks: WeeksCovered(basis, firstWeek(l), horizon), pages: newPages(l.Board.Raw), now: now,
		gamesLeft: rest.Left, projection: projection, preset: preset, week: l.Snap.Week, data: data, platform: platform,
		season: NewSeason(data, RulesOf(rulesOf(l.Saved.Scoring)), l.Snap.Week, now).WithPlatform(platform)}, nil
}

// platformWeekOf is the league platform's points for its week, by board
// id, from every side of the read the one per-platform rule says carries
// each player's points (leaguesync GivesPlayerPoints): what a final game
// whose stats have not landed counts on (Season.gamesOf, Lane 111). A
// player with no board id is left out.
func platformWeekOf(l League) PlatformWeek {
	out := PlatformWeek{Week: l.Snap.Week, Points: map[string]float64{}}
	if l.Player == nil {
		return out
	}
	for i := range l.Snap.Matchups {
		side := &l.Snap.Matchups[i]
		if !leaguesync.GivesPlayerPoints(l.Snap.Ref.Host, side) || side.PointsUnread {
			continue
		}
		for hostID, pts := range side.PlayerPoints {
			if id := l.Player(hostID).BoardId; id != nil && *id != "" {
				out.Points[*id] = pts
			}
		}
	}
	return out
}

// addressedWeek is the week an action screen addresses (Lane 95): the first
// week the member can still act on, from the member's lineup at the read's
// clock. Once every starter of the member's with a game has kicked off or
// is final by the one game state (gameStateAt, the condition weekDone fires
// on since Lane 109), byes aside, the lineup's week is spent and the
// screens turn to the next one the schedule holds; a member with no team
// in the read stays on the week.
func (a *advisor) addressedWeek() int {
	lineup, ok := a.Lineup()
	if !ok {
		return a.week
	}
	return addressedWeek(lineup.Slots, a.week, func(week int) bool { return hasGames(a.data.Games, week) })
}

// addressedWeek is week, or the week after once every starter with a game
// has kicked off or is final, when scheduled says that week holds games.
func addressedWeek(slots []apitypes.LineupSlot, week int, scheduled func(week int) bool) int {
	if everyStarterPast(slots, apitypes.GameStateKickedOff) && scheduled(week+1) {
		return week + 1
	}
	return week
}

// hasGames reports whether the schedule holds a game in the week.
func hasGames(games []boards.TeamWeek, week int) bool {
	for _, g := range games {
		if g.Week == week {
			return true
		}
	}
	return false
}

// turnTo is the advisor for another week of the same read (Lane 95): that
// week's facts (games, kickoffs, byes) with the designations carried over
// from a game already played marked so (Season.Turned), and that week's published
// projection. The rest of season, the holds and the read stay; the trade
// search is the new advisor's own.
func (a *advisor) turnTo(week int, projection boards.WeekProjection) *advisor {
	out := *a
	out.week, out.projection = week, projection
	out.season = NewSeason(a.data, RulesOf(rulesOf(a.settings.Scoring)), week, a.now).Turned().WithPlatform(a.platform)
	out.finds, out.foundHere, out.searchErr = nil, nil, nil
	return &out
}

// ProjectionCaptureLead is how long before a kickoff slot's first game the
// harvest captures the week's published projection (research
// pipeline/kickoff_slots.py LEAD, the capture's own rule): a week's first
// projection is read in the window before its first kickoff.
const ProjectionCaptureLead = 2 * time.Hour

// projectionArrivesAt is when the addressed week's published projection is
// first captured (projectionArrivesFor).
func (a *advisor) projectionArrivesAt() *time.Time {
	return projectionArrivesFor(a.data.Games, a.week, a.projection, a.now)
}

// projectionArrivesFor is when week's published projection is first
// captured, its first kickoff less ProjectionCaptureLead; nil once one is
// read, or when that moment has passed or the week holds no game.
func projectionArrivesFor(games []boards.TeamWeek, week int, projection boards.WeekProjection, now time.Time) *time.Time {
	if !projection.ReadAt.IsZero() {
		return nil
	}
	var first time.Time
	for _, g := range games {
		if g.Week == week && (first.IsZero() || g.Kickoff.Before(first)) {
			first = g.Kickoff
		}
	}
	if first.IsZero() {
		return nil
	}
	at := first.Add(-ProjectionCaptureLead)
	if !at.After(now) {
		return nil
	}
	return &at
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
	// His place among the players who play (PlayingRanks, Lane 128): the one
	// position rank the line, the badge, the caption and the order's # say.
	c := Candidate{ID: id, Position: position, Rank: a.playingRanks()[boardID], Tier: facts.Tier(),
		Locked: facts.Locked, InjuredReserve: facts.InjuredReserve(), FreeLevel: a.levels().of(position)}
	line := apitypes.PlayerLine{Player: lp, Held: boardID != "" && a.held[boardID], Facts: wireFacts(facts, thisWeek(a.Snap.Ref.Host, side, id, facts))}
	// His game at the facts' clock as every screen says it (Lane 176).
	line.GameState = lineGameState(line, a.now)
	words := Line{Name: lp.Name, Position: position, Rank: c.Rank, Facts: facts}
	// A player on a season-long list is not ranked as playing: his line
	// draws no rank (Lane 128), while the engine still orders him by it.
	if c.Rank > 0 && !facts.SeasonLong() {
		rank := c.Rank
		line.PositionRank = &rank
	}
	line.Headshot = faceOf(bp, placed)
	// A club with no game this week (a bye) has no projection, whatever a
	// snapshot says.
	if facts.Opponent != "" {
		projection := projectionAsOf(a.projection, facts)
		line.WeekProjection = weekProjectionOf(projection, a.preset, boardID, position, team)
		line.ProjectionDelta = projectionDeltaOf(projection, a.preset, boardID, position, team)
	}
	if line.WeekProjection != nil {
		// The advice ranks by the tenth the screen prints (Lane 66e).
		c.Proj, c.HasProj = roundTenth(*line.WeekProjection), true
		proj := c.Proj
		words.Proj = &proj
	}
	line.OppRank, line.SeasonAvg, line.LastPoints = evidence(facts)
	line.GamesPlayed = gamesPlayed(facts)
	if placed {
		// A kicker or defense has no page, so no link (founder ruling 2026-10-17).
		if cardPositions[position] {
			// His page stands while a list holds him (the board still places him).
			line.Slug = a.pages.of(bp.Name, a.Board.PositionRanks[boardID] > 0)
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

// projectionAsOf is the week's projection a player's row reads (Lane 92,
// B27): the newest while his game is still to come, the one as of his
// kickoff once it has kicked off, so a game under way or final keeps the
// Proj it started with.
func projectionAsOf(p boards.WeekProjection, f Facts) boards.WeekProjection {
	if !f.Locked || f.Kickoff == nil {
		return p
	}
	return p.AsOf(*f.Kickoff)
}

// weekProjectionOf is his points on the projection in the preset's
// format, to the tenth a screen prints, nil without a row.
func weekProjectionOf(p boards.WeekProjection, preset apitypes.ScoringPreset, boardID string, position draft.Position, team string) *float64 {
	got, ok := p.Player(boardID, string(position), team)
	if !ok {
		return nil
	}
	v := roundTenth(got.For(preset))
	return &v
}

// projectionDeltaOf is his projection's change since the snapshot before
// the one read, to the tenth a screen prints, nil without a row in both.
func projectionDeltaOf(p boards.WeekProjection, preset apitypes.ScoringPreset, boardID string, position draft.Position, team string) *float64 {
	d, ok := p.Delta(boardID, string(position), team, preset)
	if !ok {
		return nil
	}
	v := roundTenth(d)
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
		avg := roundTenth(*f.PerGame)
		seasonAvg = &avg
	}
	if len(f.LastGames) > 0 {
		last := roundTenth(f.LastGames[0].Points)
		lastPoints = &last
	}
	return oppRank, seasonAvg, lastPoints
}

// gamesPlayed is the games his Avg is over, nil before his first.
func gamesPlayed(f Facts) *int {
	if f.GamesPlayed == 0 {
		return nil
	}
	n := f.GamesPlayed
	return &n
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

// givesPlayerPoints is whether the platform gives each player's points for
// the side, by the one per-platform rule (leaguesync GivesPlayerPoints:
// Sleeper, MFL and ESPN do; Yahoo and FFPC give the side's total alone).
func (a *advisor) givesPlayerPoints(side *leaguesync.Side) bool {
	return leaguesync.GivesPlayerPoints(a.Snap.Ref.Host, side)
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
			pts := roundTenth(side.Points)
			return &pts
		}
	}
	return nil
}

// thisWeek is the host's points for any rostered player of the side whose
// game is under way or final, bench and starters alike (Lane 79 fix 3),
// nil where the host gives no player's points.
func thisWeek(host string, side *leaguesync.Side, id string, f Facts) *float64 {
	if !leaguesync.GivesPlayerPoints(host, side) || side.PointsUnread || !f.Locked {
		return nil
	}
	// A player the read left out (ESPN's period roster, kicked off) has
	// points unknown, never 0 (Lane 66d review H1).
	got, ok := side.PlayerPoints[id]
	if !ok {
		return nil
	}
	pts := roundTenth(got)
	return &pts
}

func wireFacts(f Facts, pointsThisWeek *float64) apitypes.WeekFacts {
	out := apitypes.WeekFacts{Week: f.Week, Home: f.Home, Kickoff: f.Kickoff, Bye: f.Bye, Played: f.Played,
		PointsThisWeek: pointsThisWeek, LastGames: make([]apitypes.GamePoints, 0, len(f.LastGames))}
	if f.Opponent != "" {
		opp := f.Opponent
		out.Opponent = &opp
	}
	if f.State != "" {
		state := f.State
		out.GameState = &state
	}
	if d := f.Designation; d != nil {
		out.Designation = &apitypes.InjuryDesignation{Status: apitypes.DesignationStatus(d.Status), AsOf: d.AsOf, Since: d.Since,
			Listed: d.Listed, ReturnWeek: d.ReturnWeek, Returning: easternDay(d.Returning)}
		if d.CarriedOver {
			carried := true
			out.Designation.CarriedOver = &carried
		}
		if d.SeasonLong {
			long := true
			out.Designation.SeasonLong = &long
		}
	}
	for _, g := range f.LastGames {
		out.LastGames = append(out.LastGames, apitypes.GamePoints{Week: g.Week, Points: roundTenth(g.Points), Source: sourceOf(g)})
	}
	if al := f.Allowed; al != nil {
		out.AllowedToPosition = &apitypes.PointsAllowed{PointsAGame: al.PointsAGame, Rank: al.Rank, Of: al.Of, Position: string(al.Position)}
	}
	c := conditionsOf(f.Game)
	out.GameTotal, out.Spread, out.Roof, out.Weather = c.total, c.spread, c.roof, c.weather
	return out
}

// sourceOf is where a game's points come from on the wire (Lane 111).
func sourceOf(g GamePoints) *apitypes.GamePointsSource {
	source := apitypes.GamePointsSourceStats
	if g.Platform {
		source = apitypes.GamePointsSourcePlatform
	}
	return &source
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
// the drafter's Hold tags when own, with the team's starters on the host
// for this week's lineup.
func (a *advisor) squad(t leaguesync.Team, people []person, own bool) Squad {
	s := Squad{Players: make([]Candidate, len(people)), Held: map[string]bool{}, Starters: t.Starters}
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

// header is what every page carries: the platform's week, the week the
// page addresses (forWeek, Lane 95), the order and the reads.
type header struct {
	week      int
	forWeek   int
	basis     apitypes.OrderBasis
	refreshed time.Time
	readAt    time.Time
}

func (a *advisor) header() header {
	return header{week: a.Snap.Week, forWeek: a.week, basis: apitypes.OrderBasis(a.basis), refreshed: a.Board.Refreshed, readAt: a.Snap.ReadAt}
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
	rows := heldNotIdle(Lineup(a.config, cands, team.Starters), cands)
	mySide := a.side(a.Me)
	h := a.header()
	// The rows end on the week's projection (Lane 66d), so the basis says
	// nothing of points a game; the page says the projection's read itself.
	un := UncountedOf(a.settings, a.season.Carries)
	out := apitypes.LineupAdvice{Week: h.week, Basis: LineupBasis(a.basis), BasisNote: un.Note, BasisNoteList: &un.Names, UncountedRules: un.Rules, OrderBasis: h.basis, Refreshed: h.refreshed,
		ReadAt: h.readAt, ProjectionReadAt: a.projectionReadAt(), ProjectionPreviousReadAt: a.projectionPreviousReadAt(), ProjectionScoring: projectionScoring(a.settings, a.preset), PlayerPoints: a.givesPlayerPoints(mySide), TeamPoints: teamPoints(mySide, people), Set: true, Slots: []apitypes.LineupSlot{}, EmptySlots: []apitypes.LineupAdviceEmptySlots{}, Bench: []apitypes.PlayerLine{}, Reserve: a.reserve(team, mySide),
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
	out.WeekDone = weekDone(out.Slots)
	if out.WeekDone != nil {
		state := a.weekDoneState(out.Slots)
		out.WeekDoneState = &state
	}
	// Where the lineup as set missed our pick, once it has kicked off (Lane 99, B11).
	out.Missed = missedLine(a.config, people, team.Starters, out.PlayerPoints)
	set := setStarters(out.Slots)
	out.ProjectedFinal = projectedFinal(out.TeamPoints, set, anyStarted(set))
	return out, true
}

// heldNotIdle is the Lineup's rows with a spot the fill left to the
// member's player un-marked where a bench player who can play this week
// would take it but his game has kicked off (fix round 1, HIGH-3): no one
// is left to move in, and the strip says nothing of it, never that no one
// on the roster can play (Lane 85's held rows). A spot no player able to
// play is eligible for keeps its mark.
func heldNotIdle(rows []Row, cands []Candidate) []Row {
	placed := map[int]bool{}
	for _, r := range rows {
		if r.Ours >= 0 {
			placed[r.Ours] = true
		}
	}
	out := make([]Row, len(rows))
	for i, r := range rows {
		out[i] = r
		if r.NoOneCanPlay && r.Ours >= 0 && lockedCandidate(r.Slot, cands, placed) {
			out[i].NoOneCanPlay = false
		}
	}
	return out
}

// lockedCandidate reports a player outside the lineup who can play this
// week and whom the slot takes, his game past kickoff.
func lockedCandidate(slot Slot, cands []Candidate, placed map[int]bool) bool {
	for p, c := range cands {
		if !placed[p] && c.Locked && c.Tier == Available && slot.accepts(c.Position) {
			return true
		}
	}
	return false
}

// setStarters is the lineup as the platform holds it, its points the
// team's score: the starters the score bug's projected final counts (fix
// round 1, MEDIUM-5), so the Lineup's figure is the bug's.
func setStarters(slots []apitypes.LineupSlot) []apitypes.PlayerLine {
	out := make([]apitypes.PlayerLine, 0, len(slots))
	for _, s := range slots {
		if line := asSet(s); line != nil {
			out = append(out, *line)
		}
	}
	return out
}

// weekDoneState is the member's matchup once their starters have all
// kicked off (Lane 91, Lane 109): final when the scoreboard's game is
// (every starter on both sides final by gameStateAt, the bug's own
// count), or with no opponent this week once the member's own starters
// are all final; locked while any starter on either side is still in
// play or still has a game to play.
func (a *advisor) weekDoneState(slots []apitypes.LineupSlot) apitypes.WeekDoneState {
	if mine := a.side(a.Me); mine != nil && mine.Game != 0 {
		for _, sides := range a.pairings() {
			if sides[0].RosterID != a.Me || sides[0].Game == 0 {
				continue
			}
			if a.scoreboardGame(sides).State != apitypes.ScoreboardGameStateFinal {
				return apitypes.WeekDoneStateLocked
			}
			return apitypes.WeekDoneStateFinal
		}
	}
	if !everyStarterPast(slots, apitypes.GameStateFinal) {
		return apitypes.WeekDoneStateLocked
	}
	return apitypes.WeekDoneStateFinal
}

// weekDone is the Lineup's sentence once every starter with a game has
// kicked off by the one state (gameStateAt), a bye starter aside (Lane
// 109): nothing is left to set from the last kickoff, not the last
// final. Its words say "kicked off" while any is in play and "played"
// once every one is final; nil while any is still to come, or with no
// starter who has a game. It says the lineup, never the week (Lane 91):
// the matchup may still play.
func weekDone(slots []apitypes.LineupSlot) *string {
	if !everyStarterPast(slots, apitypes.GameStateKickedOff) {
		return nil
	}
	words := WeekDoneWords(everyStarterPast(slots, apitypes.GameStateFinal))
	return &words
}

// everyStarterPast reports whether every starter with a game this week, a
// bye starter aside, has his game at least at state by the one game state
// (gameStateAt): kicked off (kicked off or final) or final. False with no
// starter who has a game. weekDone, weekDoneState and addressedWeek read
// it (Lane 95, Lane 109), so the Lineup's sentence and the action
// screens' week turn on the same facts at the same kickoff.
func everyStarterPast(slots []apitypes.LineupSlot, state apitypes.GameState) bool {
	games := 0
	for _, s := range slots {
		f := s.Ours.Facts
		if f.Bye || f.Kickoff == nil {
			continue
		}
		if f.GameState == nil || !atLeast(*f.GameState, state) {
			return false
		}
		games++
	}
	return games > 0
}

// atLeast reports whether a game at got has reached want: final is past
// kicked off, kicked off past upcoming.
func atLeast(got, want apitypes.GameState) bool {
	order := map[apitypes.GameState]int{apitypes.GameStateUpcoming: 0, apitypes.GameStateKickedOff: 1, apitypes.GameStateFinal: 2}
	return order[got] >= order[want]
}

// starts reports whether the league starts a position in any slot.
func (a *advisor) starts(p draft.Position) bool {
	return startsAny(a.slots, p)
}

// pool is the free agents (freeAgents) as the Waivers screen reads them.
func (a *advisor) pool(position draft.Position) []person {
	var out []person
	for _, p := range a.freeAgents(position) {
		id := p.ID
		lp := apitypes.LeaguePlayer{HostId: a.hostIDOfAdd(p), BoardId: &id, Name: p.Name, Position: string(p.Position), Team: boards.WireClub(p.Team)}
		add := a.build(p.ID, lp, nil)
		// Back this week from injured reserve (Lane 118 fix round 1): he counts in the
		// rest-of-season lineup his move is measured on, so a move that gains lists him.
		if backThisWeek(add) {
			add.cand.InjuredReserve = false
		}
		out = append(out, add)
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

// waiverRun is one ranking of the adds for the member's team: the
// roster, the pool, this week's lineup and every move the search makes,
// shared by the waiver page and the front door's pickup (Lane 66k M2).
type waiverRun struct {
	mine, pool []person
	week       *pickupWeek
	clears     map[string]openapi_types.Date
	w          *Writer
	moves      []Waiver
}

func (a *advisor) waiverRun(position draft.Position) (waiverRun, bool) {
	team, ok := a.Snap.TeamByRoster(a.Me)
	if !ok {
		return waiverRun{}, false
	}
	mine := a.active(team)
	squad := a.squad(team, mine, true)
	pool := a.pool(position)
	cands := make([]Candidate, len(pool))
	for i, p := range pool {
		cands[i] = p.cand
	}
	return waiverRun{mine: mine, pool: pool, week: newPickupWeek(a.config, squad.Players, team.Starters), clears: a.clearsOf(),
		w: &Writer{Basis: a.basis, Now: a.now}, moves: Waivers(a.config, a.weeks, squad, cands)}, true
}

// Pickups is the Waivers strip's chosen set alone: what the front door's
// pickup chip reads, by the one pickup rule (the full page's own strip).
func (a *advisor) Pickups() ([]apitypes.WaiverRow, bool) {
	out, ok := a.Waivers("", "")
	if !ok {
		return nil, false
	}
	return out.Pickups, true
}

// Waivers is the waiver page (§5). asked, a board id or "", is a player a
// link named (?player=): his row is kept past the page's cut, so the order's
// add for a free player deep in the pool lands on him (review 66j N2). The
// page's pickup order is decided over the full page's rows and its own (pageOrder).
func (a *advisor) Waivers(position draft.Position, asked string) (apitypes.WaiverAdvice, bool) {
	run, ok := a.waiverRun(position)
	if !ok {
		return apitypes.WaiverAdvice{}, false
	}
	shown := pageMoves(run.moves, run.pool, asked, MaxWaiverRows)
	// Each drop's place in the rest-of-season lineup, for the strip's Beats (B81).
	places := seasonPlacesOf(run.moves, run.mine)
	// The strip is chosen from every add we rank, before the rows' cut.
	strip, proj := run.stripMoves()
	order, ok := a.pageOrder(run, position, asked, run.orderOf(shown, strip))
	if !ok {
		return apitypes.WaiverAdvice{}, false
	}
	out := a.waiverPage(run)
	// The Stash group, apart from the rows and the strip (Lane 118, B79).
	stash, counts := a.stashRows(run, asked)
	out.Stash, out.StashUndated, out.StashLate = &stash, &counts.undated, &counts.late
	out.RegularSeasonTaken = a.regularSeasonTaken()
	for _, move := range shown {
		row := waiverRow(run.w, run.week, run.mine, run.pool[move.Add], move, run.clears)
		// A row past its kickoff has no week figure, whichever the order (Lane 85 fix round 4).
		if run.pastKickoff(move) {
			row = withheldWeek(row)
		}
		out.Rows = append(out.Rows, row)
	}
	if order == seasonOrder {
		// The rule says the week the page addresses (Lane 95), the turned one too.
		out = inSeasonOrder(out, shown, places)
		out.Basis = SeasonOrderWords(a.week)
		return out, true
	}
	if out.ProjectionReadAt == nil {
		// No published projection for the week yet (Lane 95): no Proj to
		// order the week by, so the page takes the season Gain order.
		out = inSeasonOrder(out, shown, places)
		out.Basis = UnprojectedOrderWords(a.week)
		return out, true
	}
	out.Pickups = run.strip(strip)
	// A row the strip offers names its own drop in Beats (B14).
	out.Rows = offered(out.Rows, out.Pickups, places)
	if out.ProjectionReadAt != nil {
		base := run.week.base.proj
		out.LineupProj, out.PickupsProj = &base, &proj
	}
	return out, true
}

// pageOrder is an answer's pickup order over the union of the full
// page's rows (read whole, no player asked) and the answer's own (review
// L-L, L-M): a page narrowed to one position or focused on a player takes
// the season order whenever the full page does (M-G), so the front door's
// chip and the page agree, and also when a row only it holds is past its
// kickoff, so no answer mixes withheld rows with live ones.
func (a *advisor) pageOrder(run waiverRun, position draft.Position, asked string, own apitypes.WaiverAdvicePickupOrder) (apitypes.WaiverAdvicePickupOrder, bool) {
	if own == seasonOrder || (position == "" && asked == "") {
		return own, true
	}
	full := run
	if position != "" {
		var ok bool
		if full, ok = a.waiverRun(""); !ok {
			return "", false
		}
	}
	strip, _ := full.stripMoves()
	return full.orderOf(pageMoves(full.moves, full.pool, "", MaxWaiverRows), strip), true
}

// waiverPage is the waiver page's frame with no row yet, in the week order.
func (a *advisor) waiverPage(run waiverRun) apitypes.WaiverAdvice {
	h := a.header()
	un := UncountedOf(a.settings, a.season.Carries)
	forWeek := h.forWeek
	out := apitypes.WaiverAdvice{Week: h.week, ForWeek: &forWeek, ProjectionArrivesAt: a.projectionArrivesAt(), Basis: WaiversBasisFor(a.week, a.week != a.Snap.Week), PickupOrder: weekOrder,
		SeasonBasis: withPerGame(a.Board, WaiverSeasonBasis(a.basis, a.weeks, a.horizon), run.mine, run.pool),
		BasisNote:   un.Note, BasisNoteList: &un.Names, OrderBasis: h.basis, Refreshed: h.refreshed, ReadAt: h.readAt,
		ProjectionReadAt: a.projectionReadAt(), ProjectionPreviousReadAt: a.projectionPreviousReadAt(), ProjectionScoring: projectionScoring(a.settings, a.preset),
		Pickups: []apitypes.WaiverRow{}, Rows: []apitypes.WaiverRow{}, Roster: lines(run.mine, indexes(len(run.mine))), Moves: CopyOnlyClaims(a.Snap.Ref.Host)}
	out.HostWaiversUrl, out.HostNote = a.host(WaiversPage)
	return out
}

// pageMoves is the moves a page carries: the first cut of the adds it
// lists (listedMove), and the asked player's wherever he falls, in the
// search's order.
func pageMoves(moves []Waiver, pool []person, asked string, cut int) []Waiver {
	out := make([]Waiver, 0, min(len(moves), cut+1))
	listed := 0
	for _, move := range moves {
		add := pool[move.Add]
		if isAsked(add, asked) || (listed < cut && listedMove(add, move)) {
			out = append(out, move)
		}
		if listedMove(add, move) {
			listed++
		}
	}
	return out
}

// isAsked is whether p is the player a link named by board id.
func isAsked(p person, asked string) bool {
	return asked != "" && p.line.Player.BoardId != nil && *p.line.Player.BoardId == asked
}

// waiverRow is one add's row: the rest-of-season gain with the search's
// drop, this week's on the Lineup screen's rule, whom he beats (or the
// open spot he fills), every drop he could take with its gains, and the
// day a claim on him clears.
func waiverRow(w *Writer, week *pickupWeek, mine []person, add person, move Waiver, clears map[string]openapi_types.Date) apitypes.WaiverRow {
	row := apitypes.WaiverRow{Add: add.line, Gain: roundTenth(move.Gain), Beats: replacedBeats(add, mine, move.Replaces), Drops: []apitypes.WaiverDrop{}}
	if !move.NoDrop {
		var weekGain float64
		weekGain, row.Starts, _ = week.with(add.cand, move.Drop)
		row.WeekGain = &weekGain
	}
	var drop *Line
	if move.Drop >= 0 {
		line := mine[move.Drop].line
		row.Drop, drop = &line, &mine[move.Drop].words
	}
	for _, d := range move.Drops {
		weekGain, _, _ := week.with(add.cand, d.At)
		row.Drops = append(row.Drops, apitypes.WaiverDrop{HostId: mine[d.At].cand.ID, Gain: roundTenth(d.Gain), WeekGain: &weekGain,
			StartsThisWeek: d.StartsThisWeek})
	}
	row.Pickup = !move.NoDrop && isPickup(row)
	if day, ok := clears[add.cand.ID]; ok {
		row.Clears = &day
	}
	// The sentence says he starts only when he starts this week.
	move.Starts = row.Starts
	row.Sentence = w.Waiver(add.words, drop, move)
	// A drop this week's lineup starts says who starts in his place (Lane 66u).
	if drop != nil && move.DropSlot >= 0 && move.ForSlot >= 0 {
		slots := Slots(week.config)
		row.Sentence = sentence(row.Sentence, w.StarterDrop(*drop, add.words, SlotLabel(slots, move.DropSlot),
			SlotLabel(slots, move.ForSlot), AddMove))
	}
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
	squad := a.squad(team, mine, true)
	h := a.header()
	un := UncountedOf(a.settings, a.season.Carries)
	forWeek := h.forWeek
	out := apitypes.TradeAdvice{Week: h.week, ForWeek: &forWeek, ProjectionArrivesAt: a.projectionArrivesAt(), BasisNote: un.Note, BasisNoteList: &un.Names, OrderBasis: h.basis, Refreshed: h.refreshed,
		ReadAt: h.readAt, Teams: []apitypes.TradeTeam{}, Roster: rosterLines(mine), Moves: TradeMoves(a.Snap.Ref.Host),
		ProjectionReadAt: a.projectionReadAt(), ProjectionScoring: projectionScoring(a.settings, a.preset), PlayerPoints: a.givesPlayerPoints(a.side(a.Me))}
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
		for _, tr := range Narrow(a.found()[t.RosterID], squad, a.squad(t, theirs, false), focus, TradesPerTeam) {
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
	out.Basis = TradesBasis(a.basis, a.weeks, a.horizon)
	gainBasis := TradeGainBasis(a.basis, a.weeks, a.horizon)
	out.GainBasis = &gainBasis
	restBasis := RestOfSeasonBasis(a.basis, a.weeks, a.horizon, true, a.levels().read, a.levels().lacking(a.slots))
	out.RestOfSeasonBasis = &restBasis
	out.PerGameBasis = perGameSaid(a.Board, shown...)
	out.CheckBasis = TradeCheckBasis
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
