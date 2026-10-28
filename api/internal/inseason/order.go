package inseason

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/jhunthrop/commish/api/internal/accents"
	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
	"github.com/jhunthrop/commish/api/internal/tenth"
)

// The Rest of season and Players screens (Lane 66j): our order as a box
// score, each player with his week, and in a league whose roster holds
// him and the one move his row admits.

// DefaultOrderRows and MaxOrderRows bound ?limit=.
const (
	DefaultOrderRows = 100
	MaxOrderRows     = 400
	minOrderQuery    = 2
	maxOrderQuery    = 40
)

// Field names and the words for them.
const (
	fieldQuery  = "q"
	fieldLimit  = "limit"
	fieldRoster = "roster"
	// fieldByes asks for the Players page's week order (Lane 163, D06):
	// byesLast is its one value.
	fieldByes   = "byes"
	byesLast    = "last"
	queryWords  = "Type 2 to 40 letters of a name or a club"
	limitWords  = "Ask for 1 to 400 rows"
	rosterWords = "Pick free or yours"
	byesWords   = "Ask for byes=last or leave it out"
	// orderPositionWords names the positions the order ranks.
	orderPositionWords = "Pick a position: QB, RB, WR or TE"
)

// orderQuery is one view of the order: a position or all of them, the
// letters a search holds, and how many rows it returns.
type orderQuery struct {
	position draft.Position
	q        string
	limit    int
	// roster keeps only the free players or the drafter's own (review 66j
	// H5), "" for everyone; the league's route only.
	roster apitypes.RosterMarkKind
	// byesLast puts every available player whose club is on bye in the
	// order's week after the rest (Lane 163, D06): the Players page's
	// Week N rankings never number a player on bye. The read with no
	// league only.
	byesLast bool
}

// parseOrderQuery reads ?position=, ?q=, ?limit= and, in a league, ?roster=,
// or names each field it refuses.
func parseOrderQuery(r *http.Request, league bool) (orderQuery, map[string]string) {
	values := r.URL.Query()
	out := orderQuery{position: draft.Position(values.Get(fieldPosition)), q: strings.TrimSpace(values.Get(fieldQuery)), limit: DefaultOrderRows,
		roster: apitypes.RosterMarkKind(values.Get(fieldRoster))}
	bad := map[string]string{}
	if out.roster != "" && (!league || (out.roster != apitypes.RosterMarkKindFree && out.roster != apitypes.RosterMarkKindYours)) {
		bad[fieldRoster] = rosterWords
	}
	if raw := values.Get(fieldByes); !league && raw != "" {
		out.byesLast = raw == byesLast
		if !out.byesLast {
			bad[fieldByes] = byesWords
		}
	}
	if out.position != "" && !orderPositions[out.position] {
		bad[fieldPosition] = orderPositionWords
	}
	if n := utf8.RuneCountInString(out.q); values.Has(fieldQuery) && (n < minOrderQuery || n > maxOrderQuery) {
		bad[fieldQuery] = queryWords
	}
	if raw := values.Get(fieldLimit); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > MaxOrderRows {
			bad[fieldLimit] = limitWords
		}
		out.limit = n
	}
	return out, bad
}

// orderPositions are the positions the order ranks: kickers and defenses
// are not on it, as the in-season table carries no K or DEF rows (Lane
// 66m).
var orderPositions = map[draft.Position]bool{draft.QB: true, draft.RB: true, draft.WR: true, draft.TE: true}

// ranked is the view's players in our order (orderOf on the read's board).
func (a *advisor) ranked(position draft.Position) []boards.Player {
	return orderOf(a.Board, position, a.starts)
}

// playingFirst is the order with every player on a season-long list
// (Facts.SeasonLong: injured reserve, PUP, NFI, suspended, out for the
// season, the platform's IR mark) after every available one, each group
// kept in its order and numbered on from the last available place (Lane
// 128): the in-season order never ranks him as playing (the 2026-10-16
// ruling), so his row draws the list's word in place of its number. With
// byesLast an available player whose club is on bye in the order's week
// comes last of all, after the listed players (Lane 163, D06): the week's
// rankings number the players who play it first, and his row draws no
// number; each row keeps his place in the full order (Lane 227, B209).
func (a *advisor) playingFirst(players []boards.Player, hosts map[string]string, byesLast bool) orderPlaces {
	var onBye func(boards.Player) bool
	if byesLast {
		onBye = func(p boards.Player) bool { return a.season.OnBye(p.Team) }
	}
	return placesOf(players, func(p boards.Player) bool { return a.seasonLong(p, hosts) }, onBye)
}

// seasonLong is whether a board player is on a season-long list as his
// line reads it: the capture's designation, or the platform's IR mark on
// the roster that holds him.
func (a *advisor) seasonLong(p boards.Player, hosts map[string]string) bool {
	hostIR := false
	if hostID, rostered := hosts[p.ID]; rostered {
		hostIR = a.Player(hostID).InjuredReserve
	}
	d := a.season.designation(Player{BoardID: p.ID, Team: p.Team, Position: p.Position, HostIR: hostIR, ReadAt: a.Snap.ReadAt})
	return d != nil && d.SeasonLong
}

// matches is whether a search's letters are in his name or his club,
// accents aside: "estime" finds "Audric Estimé" (Lane 78).
func matches(p boards.Player, q string) bool {
	if q == "" {
		return true
	}
	q = strings.ToLower(accents.Strip(q))
	return strings.Contains(strings.ToLower(accents.Strip(p.Name)), q) || strings.Contains(strings.ToLower(p.Team), q)
}

// hostIDs is each rostered player's id on the league's platform, by board id.
func (a *advisor) hostIDs() map[string]string {
	out := map[string]string{}
	if a.Player == nil {
		return out
	}
	for _, t := range a.Snap.Teams {
		for _, id := range t.Players {
			if lp := a.Player(id); lp.BoardId != nil {
				out[*lp.BoardId] = id
			}
		}
	}
	return out
}

// targetsPerTeam is how many of the finder's trades with each team name
// their players as targets: its best one, the trade the Trades screen leads
// with for that team (the coordinator's ruling 3: Trade for him on the rows
// the finder would admit, never on most of the order).
const targetsPerTeam = 1

// tradeTargets is every board id the trade finder brings in for the
// drafter from another roster: the players its best trade with each team
// gets. Empty when the drafter's team is not in the read.
func (a *advisor) tradeTargets() map[string]bool {
	out := map[string]bool{}
	team, ok := a.Snap.TeamByRoster(a.Me)
	if !ok {
		return out
	}
	squad := a.squad(team, a.active(team), true)
	for _, t := range a.Snap.Teams {
		if t.RosterID == a.Me {
			continue
		}
		theirs := a.active(t)
		for _, tr := range Narrow(a.found()[t.RosterID], squad, a.squad(t, theirs, false), "", targetsPerTeam) {
			for _, i := range tr.Get {
				if id := theirs[i].line.Player.BoardId; id != nil {
					out[*id] = true
				}
			}
		}
	}
	return out
}

// rosterMark is whose roster holds him in the league.
func (a *advisor) rosterMark(boardID string) apitypes.RosterMark {
	holder, held := a.HeldBy[boardID]
	switch {
	case !held:
		return apitypes.RosterMark{Kind: apitypes.RosterMarkKindFree}
	case holder == a.Me:
		return apitypes.RosterMark{Kind: apitypes.RosterMarkKindYours}
	}
	mark := apitypes.RosterMark{Kind: apitypes.RosterMarkKindTeam}
	if t, ok := a.Snap.TeamByRoster(holder); ok {
		name := t.Name
		mark.Team = &name
	}
	return mark
}

// moveOf is the one move a row admits: add a free player Waivers lists,
// trade for one the finder brings in, nothing for the drafter's own. A
// free player Waivers leaves out (unlisted: on a list with no return week
// it holds him to, Lane 128) admits none, so the order never opens Waivers
// on a player it does not list. The finder is read only for a row on
// another roster.
func moveOf(mark apitypes.RosterMark, boardID string, unlisted bool, targets Targets) *apitypes.OrderRowMove {
	var m apitypes.OrderRowMove
	switch {
	case mark.Kind == apitypes.RosterMarkKindFree && unlisted:
		return nil
	case mark.Kind == apitypes.RosterMarkKindFree:
		m = apitypes.OrderRowMoveAdd
	case mark.Kind == apitypes.RosterMarkKindTeam && targets()[boardID]:
		m = apitypes.OrderRowMoveTrade
	default:
		return nil
	}
	return &m
}

// restOfSeasonPoints is the order's key: his rest-of-season total to a
// tenth, nil on the preseason order and for a player with no projection.
func (a *advisor) restOfSeasonPoints(p boards.Player) *float64 {
	if !carriesPerGame(a.Board) || p.Points == nil {
		return nil
	}
	v := tenth.Round(*p.Points)
	return &v
}

// pointsOverReplacement is the key across positions: his points over
// replacement over the weeks the order covers, to a tenth, nil without a
// value (a position the league starts nobody at).
func (a *advisor) pointsOverReplacement(p boards.Player) *float64 {
	v, ok := a.Board.Values[p.ID]
	if !ok {
		return nil
	}
	r := tenth.Round(v)
	return &r
}

// rankBy is the key a view's # sorts on (review 66j H2): the rest-of-season
// total at a position, points over replacement across positions.
func rankBy(position draft.Position) apitypes.OrderAdviceRankBy {
	if position == "" {
		return apitypes.OrderAdviceRankByPointsOverReplacement
	}
	return apitypes.OrderAdviceRankByRestOfSeasonPoints
}

// Targets is the trade finder's targets for the drafter, read once per
// league read (review 66j M10); nil for a reader with no league.
type Targets func() map[string]bool

// onceTargets is the advisor's targets, worked out at most once per
// request and only when a row asks; the search under them is the league
// read's, kept across requests (advisor.found).
func onceTargets(a *advisor) Targets {
	var once sync.Once
	var got map[string]bool
	return func() map[string]bool {
		once.Do(func() { got = a.tradeTargets() })
		return got
	}
}

// Order is one view of our order (spec §7, Lane 66j). targets, set in a
// league, gives the rows the league's rosters and moves; nil for the reader
// with no league of their own. The finder runs only when a shown row is on
// another roster.
func (a *advisor) Order(q orderQuery, targets Targets) apitypes.OrderAdvice {
	marks := targets != nil
	h := a.header()
	scoring := projectionScoring(a.settings, a.preset)
	un := UncountedOf(a.settings, a.season.Carries)
	if !marks {
		// "Your scoring rules" are the member's: a reader with no league has none.
		un = Uncounted{}
	}
	out := apitypes.OrderAdvice{Week: h.week, Basis: OrderScreenBasis(a.basis, RestFrom{Week: a.Board.FromWeek, Partial: a.rest.Partial}, OrderLeague(marks, a.settings, scoring.Format), a.horizon), OrderBasis: h.basis,
		Refreshed: h.refreshed, ProjectionReadAt: a.projectionReadAt(), ProjectionScoring: scoring,
		BasisNote: un.Note, BasisNoteList: &un.Names, RankBy: rankBy(q.position), Rows: []apitypes.OrderRow{}}
	if carriesPerGame(a.Board) {
		from := a.Board.FromWeek
		out.FromWeek = &from
	}
	var hosts map[string]string
	if marks {
		readAt := h.readAt
		out.ReadAt = &readAt
		hosts = a.hostIDs()
	}
	places := a.playingFirst(a.ranked(q.position), hosts, q.byesLast)
	onClub := 0
	for i, p := range places.players {
		if !matches(p, q.q) || (q.roster != "" && a.rosterMark(p.ID).Kind != q.roster) {
			continue
		}
		out.Total++
		if p.Team != "" {
			onClub++
		}
		if len(out.Rows) == q.limit {
			continue
		}
		out.Rows = append(out.Rows, a.orderRow(p, places.rank[i], places.overall[i], hosts, targets))
	}
	out.OnClub = &onClub
	out.StatusRead = boards.StatusRead(a.season.designations)
	for _, r := range out.Rows {
		if r.Line.RestOfSeasonPerGame != nil {
			out.Basis += " " + PerGameBasis()
			break
		}
	}
	return out
}

// orderRow is one player's row: his line as the league's screens draw it,
// his place in the answer and in the full order, the order's two keys, and
// in a league his roster and move.
func (a *advisor) orderRow(p boards.Player, rank, overall int, hosts map[string]string, targets Targets) apitypes.OrderRow {
	person := a.boardPerson(p, hosts)
	row := apitypes.OrderRow{Line: person.line, Rank: rank, OverallRank: &overall, RestOfSeasonPoints: a.restOfSeasonPoints(p),
		PointsOverReplacement: a.pointsOverReplacement(p)}
	if targets != nil {
		mark := a.rosterMark(p.ID)
		row.Roster, row.Move = &mark, moveOf(mark, p.ID, a.unlistedAdd(person), targets)
	}
	return row
}

// boardPerson is a board player as a league's screens draw him: the
// platform's own wire name for him where a roster holds him (hosts, by
// board id), else the board's, with the id a claim on him names.
func (a *advisor) boardPerson(p boards.Player, hosts map[string]string) person {
	id := p.ID
	hostID, rostered := hosts[p.ID]
	lp := apitypes.LeaguePlayer{HostId: a.hostIDOfAdd(p), BoardId: &id, Name: p.Name, Position: string(p.Position), Team: boards.WireClub(p.Team)}
	if !rostered {
		return a.build(p.ID, lp, nil)
	}
	// His roster's side, so a game under way or final carries the
	// platform's points for him (Lane 92, B36: the week column prints them
	// once final).
	var side *leaguesync.Side
	if holder, held := a.HeldBy[p.ID]; held {
		side = a.side(holder)
	}
	return a.build(hostID, a.Player(hostID), side)
}

// leagueOrder is GET /leagues/attached/{id}/order. The verb for a free
// player is the Waivers screen's (review 66j H6): its claim moves, a failed
// check failing closed as the Waivers route's does.
func (s *Service) leagueOrder(w http.ResponseWriter, r *http.Request) {
	q, bad := parseOrderQuery(r, true)
	if len(bad) > 0 {
		httpx.WriteInvalid(w, r, bad)
		return
	}
	a, ok := s.advisorFor(w, r)
	if !ok {
		return
	}
	out := a.Order(q, onceTargets(a))
	if s.searchStopped(w, r, a) {
		return
	}
	moves := s.claimMoves(r, a)
	out.Moves = &moves
	httpx.WriteOK(w, r, http.StatusOK, out)
}

// claimMoves is the claim's moves on the league's platform, the Waivers
// route's verb rule for an add: a failed check fails closed as that
// route's does.
func (s *Service) claimMoves(r *http.Request, a *advisor) apitypes.WaiverMoves {
	moves := CopyOnlyClaims(a.Snap.Ref.Host)
	if s.Moves == nil {
		return moves
	}
	claim, err := s.Moves.ClaimMove(r.Context(), auth.AccountID(r), a.Snap.Ref.Host)
	if err != nil {
		s.Log.Warn("inseason: order claim moves", "err", err)
		claim.Claim = apitypes.WaiverMovesClaimUnavailable
		if claim.Reason == nil {
			claim.Reason = moves.Reason
		}
	}
	return claim
}

// publicOrder is GET /order: the order valued for PublicSettings, with no
// account and no league.
func (s *Service) publicOrder(w http.ResponseWriter, r *http.Request) {
	q, bad := parseOrderQuery(r, false)
	if len(bad) > 0 {
		httpx.WriteInvalid(w, r, bad)
		return
	}
	a, err := s.publicAdvisor(r.Context())
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "inseason: order", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, a.Order(q, nil))
}

// publicAdvisor is the order's advisor without a league: PublicSettings'
// board and scoring, the week of the next game still to be played.
func (s *Service) publicAdvisor(ctx context.Context) (*advisor, error) {
	settings := PublicSettings()
	board, err := s.Boards.For(ctx, settings)
	if err != nil {
		return nil, err
	}
	data, err := s.Facts.Data(ctx, s.Season)
	if err != nil {
		return nil, err
	}
	week := nextWeek(data.Games)
	l := League{Snap: leaguesync.Snapshot{Season: s.Season, Week: week}, Saved: &settings, Board: board}
	return newAdvisor(l, data, s.projection(ctx, s.Season, week), nil, s.Now(), s.Lives)
}
