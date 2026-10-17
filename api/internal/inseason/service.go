// Package inseason is the in-season tools' API (spec 2026-10-15 §7):
// start and sit, waivers and the trade finder for the drafter's own
// attached league. Each reads the league as the sync route does, our
// board valued for the league, the league's saved scoring and roster,
// and the research store's 2026 stat lines, schedule and injury
// captures. Nothing is projected for a week, and nothing here writes a
// host: the lineup says when the member may set it from our screen
// (package hostmoves makes the move).
package inseason

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// limitPerMinute is the sync routes' read limit, per account: a page
// reads once on load and once a minute while open.
const limitPerMinute = 120

// maxPlayerParam bounds ?player=, a board id.
const maxPlayerParam = 64

// Leagues answers the account's followed league for a request, or
// answers the request itself and reports false.
type Leagues interface {
	Follow(w http.ResponseWriter, r *http.Request) (League, bool)
}

// SeasonFacts is the season's facts and a week's published projection.
// *Cache implements it.
type SeasonFacts interface {
	Data(ctx context.Context, season int) (Data, error)
	Projection(ctx context.Context, season, week int) (boards.WeekProjection, error)
}

// Holds is the board ids an account tags Hold. *sheets.Store implements it.
type Holds interface {
	Held(ctx context.Context, accountID uuid.UUID) (map[string]bool, error)
}

// Moves says whether the account may set its lineup, or claim, on the
// host from our screen. *hostmoves.Service implements it; nil, the verb
// is always the host's page.
type Moves interface {
	LineupMove(ctx context.Context, accountID uuid.UUID, host string) (apitypes.LineupMoves, error)
	ClaimMove(ctx context.Context, accountID uuid.UUID, host string) (apitypes.WaiverMoves, error)
}

// Service serves the three pages and the trade check.
type Service struct {
	Leagues Leagues
	Facts   SeasonFacts
	Holds   Holds
	Moves   Moves
	// Weeks lists the account's leagues for GET /me/week, nil answers none.
	Weeks Weeks
	// Season is the season GET /games/week reads, the board's.
	Season int
	Now    func() time.Time
	Log    *slog.Logger
}

// Routes is every route this package serves.
func (s *Service) Routes() []httpx.Route {
	limit := httpx.PerMinute(limitPerMinute)
	return []httpx.Route{
		{Method: http.MethodGet, Path: "/leagues/attached/{id}/lineup", Access: httpx.SignedIn, Limit: limit, Handler: s.lineup},
		{Method: http.MethodGet, Path: "/leagues/attached/{id}/matchup", Access: httpx.SignedIn, Limit: limit, Handler: s.matchup},
		{Method: http.MethodGet, Path: "/leagues/attached/{id}/scoreboard", Access: httpx.SignedIn, Limit: limit, Handler: s.scoreboard},
		{Method: http.MethodGet, Path: "/leagues/attached/{id}/waivers", Access: httpx.SignedIn, Limit: limit, Handler: s.waivers},
		{Method: http.MethodGet, Path: "/leagues/attached/{id}/trades", Access: httpx.SignedIn, Limit: limit, Handler: s.trades},
		{Method: http.MethodPost, Path: "/leagues/attached/{id}/trades/check", Access: httpx.SignedIn, Limit: limit, Handler: s.checkTrade},
		{Method: http.MethodGet, Path: "/games/week", Access: httpx.Public, Limit: limit, Handler: s.weekGames},
		{Method: http.MethodGet, Path: "/me/week", Access: httpx.SignedIn, Limit: limit, Handler: s.week},
	}
}

// Field names and the drafter's words for them.
const (
	fieldPosition = "position"
	fieldPlayer   = "player"
	positionWords = "Pick a position: QB, RB, WR, TE, K or DEF"
	playerWords   = "That player is not on a roster in this league"
	noTeamWords   = "We could not find your team in this league's last read"
)

// advisorFor is the request's league with its facts, or an answer: a
// league with no saved scoring answers 422 naming why, a league with no
// current week 409 in the league page's words. A stale host read is no
// error: read_at says how stale.
func (s *Service) advisorFor(w http.ResponseWriter, r *http.Request) (*advisor, bool) {
	l, ok := s.Leagues.Follow(w, r)
	if !ok {
		return nil, false
	}
	if l.Saved == nil {
		httpx.WriteError(w, r, http.StatusUnprocessableEntity, httpx.CodeInvalid, l.SettingsNote, nil)
		return nil, false
	}
	if l.Snap.Week == 0 {
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, leaguesync.NoGamesWords, nil)
		return nil, false
	}
	ctx := r.Context()
	data, err := s.Facts.Data(ctx, seasonOf(l))
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "inseason: facts", err)
		return nil, false
	}
	held, err := s.Holds.Held(ctx, auth.AccountID(r))
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "inseason: held", err)
		return nil, false
	}
	a, err := newAdvisor(l, data, s.projection(ctx, seasonOf(l), l.Snap.Week), held, s.Now())
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "inseason: advisor", err)
		return nil, false
	}
	return a, true
}

// projection is the week's published projection. A read that fails is
// logged and the rows answer without it: the column says "--", the page
// still answers.
func (s *Service) projection(ctx context.Context, season, week int) boards.WeekProjection {
	p, err := s.Facts.Projection(ctx, season, week)
	if err != nil {
		s.Log.Warn("inseason: the week's projection was not read; the rows answer without it", "week", week, "err", err)
		return boards.WeekProjection{Week: week}
	}
	return p
}

// seasonOf is the season whose facts the league's week reads: the
// league's own, else the board's.
func seasonOf(l League) int {
	if l.Snap.Season > 0 {
		return l.Snap.Season
	}
	return l.Board.Raw.Season
}

func (s *Service) lineup(w http.ResponseWriter, r *http.Request) {
	a, ok := s.advisorFor(w, r)
	if !ok {
		return
	}
	out, ok := a.Lineup()
	if ok && s.Moves != nil {
		// A failed check fails closed: the verb is the host's page, and
		// start and sit still answers.
		out.Moves = s.lineupMoves(r.Context(), auth.AccountID(r), a.Snap.Ref.Host)
	}
	s.answer(w, r, out, ok)
}

// matchup is the week's matchup as a box score.
func (s *Service) matchup(w http.ResponseWriter, r *http.Request) {
	a, ok := s.advisorFor(w, r)
	if !ok {
		return
	}
	out, ok := a.Matchup()
	s.answer(w, r, out, ok)
}

func (s *Service) scoreboard(w http.ResponseWriter, r *http.Request) {
	a, ok := s.advisorFor(w, r)
	if !ok {
		return
	}
	s.answer(w, r, a.Scoreboard(), true)
}

func (s *Service) waivers(w http.ResponseWriter, r *http.Request) {
	position := draft.Position(r.URL.Query().Get(fieldPosition))
	if position != "" && !position.Valid() {
		httpx.WriteInvalid(w, r, map[string]string{fieldPosition: positionWords})
		return
	}
	a, ok := s.advisorFor(w, r)
	if !ok {
		return
	}
	out, ok := a.Waivers(position)
	if ok && s.Moves != nil {
		// A failed check fails closed, as the lineup's does.
		moves, err := s.Moves.ClaimMove(r.Context(), auth.AccountID(r), a.Snap.Ref.Host)
		if err != nil {
			// What the check knew before it failed is kept, the claim closed,
			// and the line always set, as the lineup's (review 66f M2).
			s.Log.Warn("inseason: claim moves", "err", err)
			moves.Claim = apitypes.WaiverMovesClaimUnavailable
			if moves.Reason == nil {
				moves.Reason = CopyOnlyClaims(a.Snap.Ref.Host).Reason
			}
		}
		out.Moves = moves
	}
	s.answer(w, r, out, ok)
}

func (s *Service) trades(w http.ResponseWriter, r *http.Request) {
	player := r.URL.Query().Get(fieldPlayer)
	if len(player) > maxPlayerParam {
		httpx.WriteInvalid(w, r, map[string]string{fieldPlayer: playerWords})
		return
	}
	a, ok := s.advisorFor(w, r)
	if !ok {
		return
	}
	focus := ""
	if player != "" {
		if focus = a.hostIDOf(player); focus == "" {
			httpx.WriteInvalid(w, r, map[string]string{fieldPlayer: playerWords})
			return
		}
	}
	out, ok := a.Trades(focus)
	s.answer(w, r, out, ok)
}

// checkTrade answers one trade the drafter built (the trade builder):
// the body checked before the league is read, a team or player the read
// does not hold as asked refused in a sentence naming him.
func (s *Service) checkTrade(w http.ResponseWriter, r *http.Request) {
	var in apitypes.TradeCheckInput
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	if fields := checkFields(in); len(fields) > 0 {
		httpx.WriteInvalid(w, r, fields)
		return
	}
	a, ok := s.advisorFor(w, r)
	if !ok {
		return
	}
	out, refused, ok := a.CheckTrade(in)
	if refused != nil {
		httpx.WriteError(w, r, http.StatusUnprocessableEntity, httpx.CodeInvalid, refused.sentence,
			map[string]string{refused.field: refused.sentence})
		return
	}
	s.answer(w, r, out, ok)
}

// answer writes a page, or says the drafter's team is not in the read.
func (s *Service) answer(w http.ResponseWriter, r *http.Request, out any, ok bool) {
	if !ok {
		httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeTeamNotRead, noTeamWords, nil)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, out)
}

// SyncLeagues is league sync as the routes' Leagues: the sync route's
// read of the account's league.
type SyncLeagues struct{ Sync *leaguesync.Service }

// Follow is the account's league, or the sync route's answer.
func (l SyncLeagues) Follow(w http.ResponseWriter, r *http.Request) (League, bool) {
	f, ok := l.Sync.Follow(w, r)
	if !ok {
		return League{}, false
	}
	return leagueOf(f), true
}

// leagueOf is a followed league as the advice reads it.
func leagueOf(f leaguesync.Followed) League {
	out := League{Snap: f.Snap, Me: f.Link.RosterID, Saved: f.Saved, Board: f.Board, HeldBy: f.HeldBy, Player: f.Player}
	if f.Saved == nil {
		out.SettingsNote = f.SettingsNote()
	}
	return out
}
