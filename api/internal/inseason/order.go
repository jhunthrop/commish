package inseason

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
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
	fieldQuery = "q"
	fieldLimit = "limit"
	queryWords = "Type 2 to 40 letters of a name or a club"
	limitWords = "Ask for 1 to 400 rows"
)

// Boards is the board a league of these settings drafts from, valued for
// its roster. *draftroom.Boards implements it.
type Boards interface {
	For(ctx context.Context, s apitypes.LeagueSettings) (boards.Board, error)
}

// PublicLeague is the league the order is valued for when the reader has
// none of their own: 12 teams, PPR, QB, 2 RB, 3 WR, TE, a flex, K and DEF.
func PublicLeague() apitypes.LeagueSettings {
	ppr := apitypes.ScoringPresetPpr
	return apitypes.LeagueSettings{Teams: 12, Lineup: apitypes.LineupStandard, Scoring: apitypes.Scoring{Preset: &ppr},
		Roster: apitypes.RosterCounts{Qb: 1, Rb: 2, Wr: 3, Te: 1, K: 1, Dst: 1, Bench: 6}}
}

// orderQuery is one view of the order: a position or all of them, the
// letters a search holds, and how many rows it returns.
type orderQuery struct {
	position draft.Position
	q        string
	limit    int
}

// parseOrderQuery reads ?position=, ?q= and ?limit=, or names each field
// it refuses.
func parseOrderQuery(r *http.Request) (orderQuery, map[string]string) {
	values := r.URL.Query()
	out := orderQuery{position: draft.Position(values.Get(fieldPosition)), q: strings.TrimSpace(values.Get(fieldQuery)), limit: DefaultOrderRows}
	bad := map[string]string{}
	if out.position != "" && !out.position.Valid() {
		bad[fieldPosition] = positionWords
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

// ranked is the view's players in our order with each one's place in it:
// at a position his position rank, across positions his place by points
// over replacement, a kicker or defense (no projection) after every
// projected player in the order drafters take them.
func (a *advisor) ranked(position draft.Position) ([]boards.Player, []int) {
	var players []boards.Player
	for _, p := range a.Board.Raw.Players {
		if (position == "" || p.Position == position) && a.starts(p.Position) {
			players = append(players, p)
		}
	}
	if position != "" {
		sort.SliceStable(players, func(i, j int) bool {
			return a.Board.PositionRanks[players[i].ID] < a.Board.PositionRanks[players[j].ID]
		})
		ranks := make([]int, len(players))
		for i, p := range players {
			ranks[i] = a.Board.PositionRanks[p.ID]
		}
		return players, ranks
	}
	sort.SliceStable(players, func(i, j int) bool {
		vi, hi := a.Board.Values[players[i].ID]
		vj, hj := a.Board.Values[players[j].ID]
		if hi != hj {
			return hi
		}
		return hi && vi > vj
	})
	ranks := make([]int, len(players))
	for i := range players {
		ranks[i] = i + 1
	}
	return players, ranks
}

// matches is whether a search's letters are in his name or his club.
func matches(p boards.Player, q string) bool {
	if q == "" {
		return true
	}
	q = strings.ToLower(q)
	return strings.Contains(strings.ToLower(p.Name), q) || strings.Contains(strings.ToLower(p.Team), q)
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

// tradeTargets is every board id the trade finder brings in for the
// drafter from another roster: the players its best trades with each team
// get. Empty when the drafter's team is not in the read.
func (a *advisor) tradeTargets() map[string]bool {
	out := map[string]bool{}
	team, ok := a.Snap.TeamByRoster(a.Me)
	if !ok {
		return out
	}
	squad := a.squad(a.active(team), true)
	for _, t := range a.Snap.Teams {
		if t.RosterID == a.Me {
			continue
		}
		theirs := a.active(t)
		for _, tr := range Trades(a.config, a.weeks, squad, a.squad(theirs, false), "", TradesPerTeam) {
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

// moveOf is the one move a row admits: add a free player, trade for one
// the finder brings in, nothing for the drafter's own.
func moveOf(mark apitypes.RosterMark, boardID string, targets map[string]bool) *apitypes.OrderRowMove {
	var m apitypes.OrderRowMove
	switch {
	case mark.Kind == apitypes.RosterMarkKindFree:
		m = apitypes.OrderRowMoveAdd
	case mark.Kind == apitypes.RosterMarkKindTeam && targets[boardID]:
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
	v := roundTenth(*p.Points)
	return &v
}

// Order is one view of our order (spec §7, Lane 66j). marks says whether
// the rows carry the league's rosters and moves: false for the reader with
// no league of their own.
func (a *advisor) Order(q orderQuery, marks bool) apitypes.OrderAdvice {
	h := a.header()
	out := apitypes.OrderAdvice{Week: h.week, Basis: OrderScreenBasis(a.basis, a.Board.FromWeek), OrderBasis: h.basis,
		Refreshed: h.refreshed, ProjectionReadAt: a.projectionReadAt(), ProjectionScoring: projectionScoring(a.settings, a.preset),
		BasisNote: BasisNote(a.settings, a.season.Carries), Rows: []apitypes.OrderRow{}}
	if carriesPerGame(a.Board) {
		from := a.Board.FromWeek
		out.FromWeek = &from
	}
	if marks {
		readAt := h.readAt
		out.ReadAt = &readAt
	}
	players, ranks := a.ranked(q.position)
	var hosts map[string]string
	var targets map[string]bool
	if marks {
		hosts, targets = a.hostIDs(), a.tradeTargets()
	}
	for i, p := range players {
		if !matches(p, q.q) {
			continue
		}
		out.Total++
		if len(out.Rows) == q.limit {
			continue
		}
		out.Rows = append(out.Rows, a.orderRow(p, ranks[i], marks, hosts, targets))
	}
	return out
}

// orderRow is one player's row: his line as the league's screens draw it,
// his place, the order's key, and with marks his roster and move.
func (a *advisor) orderRow(p boards.Player, rank int, marks bool, hosts map[string]string, targets map[string]bool) apitypes.OrderRow {
	id := p.ID
	hostID, rostered := hosts[p.ID]
	lp := apitypes.LeaguePlayer{HostId: a.hostIDOfAdd(p), BoardId: &id, Name: p.Name, Position: string(p.Position), Team: p.Team}
	if rostered {
		lp = a.Player(hostID)
	} else {
		hostID = p.ID
	}
	row := apitypes.OrderRow{Line: a.build(hostID, lp, nil).line, Rank: rank, RestOfSeasonPoints: a.restOfSeasonPoints(p)}
	if marks {
		mark := a.rosterMark(p.ID)
		row.Roster, row.Move = &mark, moveOf(mark, p.ID, targets)
	}
	return row
}

// leagueOrder is GET /leagues/attached/{id}/order.
func (s *Service) leagueOrder(w http.ResponseWriter, r *http.Request) {
	q, bad := parseOrderQuery(r)
	if len(bad) > 0 {
		httpx.WriteInvalid(w, r, bad)
		return
	}
	a, ok := s.advisorFor(w, r)
	if !ok {
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, a.Order(q, true))
}

// publicOrder is GET /order: the order valued for PublicLeague, with no
// account and no league.
func (s *Service) publicOrder(w http.ResponseWriter, r *http.Request) {
	q, bad := parseOrderQuery(r)
	if len(bad) > 0 {
		httpx.WriteInvalid(w, r, bad)
		return
	}
	a, err := s.publicAdvisor(r.Context())
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "inseason: order", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, a.Order(q, false))
}

// publicAdvisor is the order's advisor without a league: PublicLeague's
// board and scoring, the week of the next game still to be played.
func (s *Service) publicAdvisor(ctx context.Context) (*advisor, error) {
	settings := PublicLeague()
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
	return newAdvisor(l, data, s.projection(ctx, s.Season, week), nil, s.Now())
}
