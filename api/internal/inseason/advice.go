package inseason

import (
	"fmt"
	"sort"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
	"github.com/jhunthrop/commish/api/internal/mock"
	"github.com/jhunthrop/commish/api/internal/scoring"
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
	now   time.Time
}

// newAdvisor reads the league's roster shape and scoring from the saved
// league and indexes the facts for its week. held is the board ids the
// drafter tags Hold.
func newAdvisor(l League, data Data, held map[string]bool, now time.Time) (*advisor, error) {
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
	return &advisor{League: l, settings: *l.Saved, config: config, slots: Slots(config), held: held, basis: basis, weeks: WeeksCovered(basis, firstWeek(l)), pages: newPages(l.Board.Raw), now: now,
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
	if placed {
		line.Slug = a.pages.of(bp.Name, c.Rank > 0)
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

// thisWeek is the host's points for a starter whose game has kicked off.
func thisWeek(side *leaguesync.Side, id string, f Facts) *float64 {
	if side == nil || side.PointsUnread || !f.Locked {
		return nil
	}
	for _, s := range side.Starters {
		if s == id {
			pts := roundCents(side.PlayerPoints[id])
			return &pts
		}
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
		out.Designation = &apitypes.InjuryDesignation{Status: apitypes.InjuryDesignationStatus(d.Status), AsOf: d.AsOf}
	}
	for _, g := range f.LastGames {
		out.LastGames = append(out.LastGames, apitypes.GamePoints{Week: g.Week, Points: g.Points})
	}
	if al := f.Allowed; al != nil {
		out.AllowedToPosition = &apitypes.PointsAllowed{PointsAGame: al.PointsAGame, Rank: al.Rank, Of: al.Of, Position: string(al.Position)}
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
	h := a.header()
	out := apitypes.LineupAdvice{Week: h.week, Basis: LineupBasis(a.basis, a.weeks), BasisNote: BasisNote(a.settings), OrderBasis: h.basis, Refreshed: h.refreshed,
		ReadAt: h.readAt, Set: true, Slots: []apitypes.LineupSlot{}, Bench: []apitypes.PlayerLine{},
		Moves: apitypes.LineupMoves{Lineup: apitypes.LineupMovesLineupUnavailable},
	}
	out.HostLineupUrl, out.HostNote = a.host(LineupPage)
	w := &Writer{Basis: a.basis, Now: a.now}
	starting := map[int]bool{}
	for _, r := range rows {
		if r.Ours < 0 {
			continue
		}
		starting[r.Ours] = true
		slot := apitypes.LineupSlot{Slot: apitypes.LineupSlotSlot(r.Slot.Type), Ours: people[r.Ours].line, Changed: r.Changed}
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
		lp := apitypes.LeaguePlayer{BoardId: &id, Name: p.Name, Position: string(p.Position), Team: p.Team}
		out = append(out, a.build(p.ID, lp, nil))
	}
	return out
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
	out := apitypes.WaiverAdvice{Week: h.week, Basis: WaiversBasis(a.basis, a.weeks), BasisNote: BasisNote(a.settings), OrderBasis: h.basis, Refreshed: h.refreshed,
		ReadAt: h.readAt, Rows: []apitypes.WaiverRow{}, Moves: apitypes.WaiverMoves{Claim: apitypes.WaiverMovesClaimUnavailable}}
	out.HostWaiversUrl, out.HostNote = a.host(WaiversPage)
	w := &Writer{Basis: a.basis, Now: a.now}
	for _, move := range Waivers(a.config, a.weeks, squad, cands) {
		if len(out.Rows) == MaxWaiverRows {
			break
		}
		add := pool[move.Add]
		row := apitypes.WaiverRow{Add: add.line, Gain: roundTenth(move.Gain),
			Starts: move.Starts && positive(move.Gain) && add.cand.Tier != Out}
		var drop *Line
		if move.Drop >= 0 {
			line := mine[move.Drop].line
			row.Drop, drop = &line, &mine[move.Drop].words
		}
		// The sentence says he starts only when he starts this week.
		move.Starts = row.Starts
		row.Sentence = w.Waiver(add.words, drop, move)
		out.Rows = append(out.Rows, row)
	}
	if len(out.Rows) > 0 && out.Rows[0].Gain > 0 {
		best := out.Rows[0]
		out.Best = &best
	}
	return out, true
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
	out := apitypes.TradeAdvice{Week: h.week, Basis: TradesBasis(a.basis, a.weeks), BasisNote: BasisNote(a.settings), OrderBasis: h.basis, Refreshed: h.refreshed,
		ReadAt: h.readAt, Teams: []apitypes.TradeTeam{}, Roster: rosterLines(mine)}
	out.HostTradesUrl, out.HostNote = a.host(TradesPage)
	for _, t := range leaguesync.Standings(a.Snap.Teams) {
		if t.RosterID == a.Me {
			continue
		}
		theirs := a.active(t)
		row := apitypes.TradeTeam{RosterId: t.RosterID, Name: t.Name, Owner: t.Owner,
			Record: apitypes.TradeRecord{Wins: t.Wins, Losses: t.Losses, Ties: t.Ties}, Trades: []apitypes.TradeRow{}}
		close := 0
		for _, tr := range Trades(a.config, a.weeks, squad, a.squad(theirs, false), focus, TradesPerTeam) {
			wire := apitypes.TradeRow{Give: lines(mine, tr.Give), Get: lines(theirs, tr.Get),
				MyGain: roundTenth(tr.MyGain), TheirGain: roundTenth(tr.TheirGain), CloseForThem: tr.CloseForThem()}
			if tr.Drop >= 0 {
				drop := mine[tr.Drop].line
				wire.Drop = &drop
			}
			row.Trades = append(row.Trades, wire)
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
