// Package hostmoves makes a move on a host with the member's stored
// session, after the member confirms it on our screen (spec 2026-10-15
// §10.2; docs/research/2026-10-15-host-writes-design.md §6): one
// host-neutral route plans the move in words with a confirm token, a
// second makes it once with that token. The first move is an ESPN lineup
// set, behind HOST_WRITES_ESPN_LINEUP and a per-account allow list. Every
// move is kept as its proof; a cookie never is, nor is a move retried on
// its own.
package hostmoves

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/espnhost"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/inseason"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// Bounds on the routes, per account: a handful of moves a minute.
const (
	limitPlanPerMinute = 20
	limitMovePerMinute = 5
	limitListPerMinute = 60
	maxChanges         = 10
	maxWeek            = 25
	maxConfirm         = 200
	// afterSend bounds the read-back and the proof's update once a move
	// left, cut loose from the request so a closed tab never loses them.
	afterSend = 30 * time.Second
)

// kindLineup is the one move kind today.
const kindLineup = "lineup"

var hostID = regexp.MustCompile(`^-?[0-9]{1,12}$`)

// Links reads the account's attached league. *leaguesync.Store
// implements it.
type Links interface {
	Get(ctx context.Context, accountID, id uuid.UUID) (leaguesync.Link, error)
}

// Connections reads the account's host connection. *hosts.Store
// implements it.
type Connections interface {
	Get(ctx context.Context, accountID uuid.UUID, host string) (hosts.Connection, error)
}

// Member reads ESPN as the member. *espnhost.Member implements it.
type Member interface {
	Cookies(ctx context.Context, accountID uuid.UUID) (espn.Cookies, error)
	ReadLeague(ctx context.Context, accountID uuid.UUID, leagueID string, season int) (espn.FullLeague, error)
}

// Writer sends a lineup set and reads it back. *espn.Client implements it.
type Writer interface {
	SetLineup(ctx context.Context, cookies espn.Cookies, set espn.LineupSet) (espn.WriteAnswer, error)
	Applied(ctx context.Context, cookies espn.Cookies, set espn.LineupSet) (bool, error)
}

// Proofs is the allow list and the proof records. *Store implements it.
type Proofs interface {
	Allowed(ctx context.Context, accountID uuid.UUID, host, kind string) (bool, error)
	Used(ctx context.Context, accountID uuid.UUID, digest []byte) (bool, error)
	Begin(ctx context.Context, r Record) (uuid.UUID, error)
	Answered(ctx context.Context, accountID, id uuid.UUID, a Answer, at time.Time) error
	List(ctx context.Context, accountID, linkID uuid.UUID) ([]Kept, error)
}

// Service serves planning, making and listing moves.
type Service struct {
	// ESPNOpen is ESPN open here: HOST_ESPN_ENABLED with the vault's key.
	// Closed, no ESPN move is.
	ESPNOpen bool
	// ESPNLineup is HOST_WRITES_ESPN_LINEUP: on, every connected member
	// may set an ESPN lineup; off, only the accounts on the allow list.
	ESPNLineup  bool
	Links       Links
	Connections Connections
	Member      Member
	Writer      Writer
	Proofs      Proofs
	Signer      Signer
	Now         func() time.Time
	Log         *slog.Logger
}

// Routes is every route this package serves.
func (s *Service) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodPost, Path: "/leagues/attached/{id}/moves/plan", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitPlanPerMinute), Handler: s.plan},
		{Method: http.MethodPost, Path: "/leagues/attached/{id}/moves", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitMovePerMinute), Handler: s.move},
		{Method: http.MethodGet, Path: "/leagues/attached/{id}/moves", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitListPerMinute), Handler: s.list},
	}
}

// LineupMove says whether the account may set its lineup on the host
// from our screen, and the sentence when a move waits on the member. The
// start screen's answer carries it.
func (s *Service) LineupMove(ctx context.Context, accountID uuid.UUID, host string) (apitypes.LineupMoves, error) {
	open, note, err := s.open(ctx, accountID, host)
	out := apitypes.LineupMoves{Lineup: apitypes.LineupMovesLineupUnavailable}
	if err != nil {
		return out, err
	}
	if open {
		out.Lineup = apitypes.LineupMovesLineupAvailable
	}
	if note != "" {
		out.Note = &note
	}
	return out, nil
}

// open reports whether a lineup move is open to the account on the host:
// the host has a write path, its switch or the allow list lets the
// account make it, and the account's connection is connected and agreed
// to words that name the moves. When it is closed on the member's side,
// note says what to do.
func (s *Service) open(ctx context.Context, accountID uuid.UUID, host string) (bool, string, error) {
	if host != espnhost.Host || !s.ESPNOpen {
		return false, "", nil
	}
	if !s.ESPNLineup {
		allowed, err := s.Proofs.Allowed(ctx, accountID, host, kindLineup)
		if err != nil || !allowed {
			return false, "", err
		}
	}
	conn, err := s.Connections.Get(ctx, accountID, host)
	switch {
	case errors.Is(err, hosts.ErrNotConnected):
		return false, "", nil
	case err != nil:
		return false, "", err
	case conn.Status != hosts.StatusConnected:
		return false, reconnectWords, nil
	case conn.ConsentVersion < hosts.ESPNConsentVersion:
		return false, reconsentWords, nil
	}
	return true, "", nil
}

// checkMove checks the move's shape before anything is read.
func checkMove(mv apitypes.HostMoveInput) bool {
	if mv.Kind != kindLineup || mv.Week < 1 || mv.Week > maxWeek || len(mv.Changes) == 0 || len(mv.Changes) > maxChanges {
		return false
	}
	for _, c := range mv.Changes {
		if _, ok := espnSlots[c.Slot]; !ok || !hostID.MatchString(c.In) || (c.Out != nil && !hostID.MatchString(*c.Out)) {
			return false
		}
	}
	return true
}

// link is the account's attached league, or a 404.
func (s *Service) link(w http.ResponseWriter, r *http.Request) (leaguesync.Link, bool) {
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return leaguesync.Link{}, false
	}
	link, err := s.Links.Get(r.Context(), auth.AccountID(r), id)
	if errors.Is(err, leaguesync.ErrLinkNotFound) {
		httpx.WriteNotFound(w, r)
		return leaguesync.Link{}, false
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "hostmoves: link", err)
		return leaguesync.Link{}, false
	}
	return link, true
}

// prepared is a move checked against a fresh read, or the sentence for
// why it is unavailable here (unavailable is "" when it is ready).
type prepared struct {
	plan        lineupPlan
	cookies     espn.Cookies
	unavailable string
}

// prepare checks the move is open to the account, reads the league as
// the member and plans the move on their own team. It answers a refusal
// itself and reports false.
func (s *Service) prepare(w http.ResponseWriter, r *http.Request, link leaguesync.Link, mv apitypes.HostMoveInput) (prepared, bool) {
	ctx, accountID := r.Context(), auth.AccountID(r)
	open, note, err := s.open(ctx, accountID, link.Ref.Host)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "hostmoves: open", err)
		return prepared{}, false
	}
	if !open {
		if note == "" {
			note = offWords
		}
		return prepared{unavailable: note}, true
	}
	cookies, err := s.Member.Cookies(ctx, accountID)
	var l espn.FullLeague
	if err == nil {
		l, err = s.Member.ReadLeague(ctx, accountID, link.Ref.LeagueID, link.Ref.Season)
	}
	switch {
	case errors.Is(err, hosts.ErrNotConnected):
		return prepared{unavailable: offWords}, true
	case errors.Is(err, espnhost.ErrReconnect), errors.Is(err, espn.ErrSignedOut):
		return prepared{unavailable: reconnectWords}, true
	case errors.Is(err, espn.ErrPrivate):
		httpx.WriteError(w, r, http.StatusUnprocessableEntity, httpx.CodeInvalid, notYourTeamWords, nil)
		return prepared{}, false
	case err != nil:
		s.Log.Warn("hostmoves: read the league", "account", accountID, "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, notAnsweringWord, nil)
		return prepared{}, false
	}
	plan, err := planLineup(l, cookies.SWID, link.RosterID, mv)
	var ref *refusal
	if errors.As(err, &ref) {
		s.Log.Info("hostmoves: plan refused", "account", accountID, "why", ref.cause.Error())
		httpx.WriteError(w, r, http.StatusUnprocessableEntity, httpx.CodeInvalid, ref.words, nil)
		return prepared{}, false
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "hostmoves: plan", err)
		return prepared{}, false
	}
	return prepared{plan: plan, cookies: cookies}, true
}

func hostURL(link leaguesync.Link) string {
	return inseason.HostURL(link.Ref, link.RosterID, inseason.LineupPage)
}

// plan answers the move in words with its confirm token; nothing is sent.
func (s *Service) plan(w http.ResponseWriter, r *http.Request) {
	var mv apitypes.HostMoveInput
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &mv) {
		return
	}
	if !checkMove(mv) {
		httpx.WriteInvalid(w, r, map[string]string{fieldMove: moveFormWords})
		return
	}
	link, ok := s.link(w, r)
	if !ok {
		return
	}
	p, ok := s.prepare(w, r, link, mv)
	if !ok {
		return
	}
	out := apitypes.HostMovePlan{Status: apitypes.HostMovePlanStatusUnavailable, Sentence: p.unavailable, HostUrl: hostURL(link)}
	if p.unavailable == "" {
		expires := s.Now().Add(ConfirmFor).UTC().Truncate(time.Second)
		token, err := s.Signer.Sign(auth.AccountID(r), link.ID, mv, expires)
		if err != nil {
			httpx.WriteInternal(w, r, s.Log, "hostmoves: sign", err)
			return
		}
		out.Status, out.Sentence, out.Confirm, out.ExpiresAt = apitypes.HostMovePlanStatusReady, p.plan.sentence, &token, &expires
	}
	httpx.WriteOK(w, r, http.StatusOK, out)
}

// move makes the planned move once with its token: checked again on a
// fresh read, kept before it is sent, sent once, read back, and kept with
// what it came to.
func (s *Service) move(w http.ResponseWriter, r *http.Request) {
	var in apitypes.HostMoveConfirm
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	if !checkMove(in.Move) || in.Confirm == "" || len(in.Confirm) > maxConfirm {
		httpx.WriteInvalid(w, r, map[string]string{fieldMove: moveFormWords})
		return
	}
	link, ok := s.link(w, r)
	if !ok {
		return
	}
	accountID := auth.AccountID(r)
	sum, err := s.Signer.Verify(in.Confirm, accountID, link.ID, in.Move, s.Now())
	if err != nil {
		words := tokenOtherWords
		if errors.Is(err, ErrTokenExpired) {
			words = tokenExpiredWords
		}
		httpx.WriteInvalid(w, r, map[string]string{fieldConfirm: words})
		return
	}
	// A used token says so before the fresh read, which would find the
	// move made and call the screen stale.
	used, err := s.Proofs.Used(r.Context(), accountID, sum)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "hostmoves: used", err)
		return
	}
	if used {
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, tokenUsedWords, nil)
		return
	}
	p, ok := s.prepare(w, r, link, in.Move)
	if !ok {
		return
	}
	if p.unavailable != "" {
		httpx.WriteOK(w, r, http.StatusOK, apitypes.HostMoveResult{Outcome: apitypes.HostMoveResultOutcomeUnavailable, Sentence: p.unavailable, HostUrl: hostURL(link)})
		return
	}
	s.send(w, r, link, in.Move, sum, p)
}

// planRecord is the plan as the proof keeps it: the words and the items.
type planRecord struct {
	Sentence string            `json:"sentence"`
	Team     int               `json:"team"`
	Period   int               `json:"scoring_period"`
	Items    []espn.LineupItem `json:"items"`
}

// send keeps the move, sends it once and answers what it came to.
func (s *Service) send(w http.ResponseWriter, r *http.Request, link leaguesync.Link, mv apitypes.HostMoveInput, sum []byte, p prepared) {
	accountID, set := auth.AccountID(r), p.plan.set
	body, err := set.Body()
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "hostmoves: body", err)
		return
	}
	planJSON, err := json.Marshal(planRecord{Sentence: p.plan.sentence, Team: set.Team(), Period: set.Period(), Items: set.Items()})
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "hostmoves: plan record", err)
		return
	}
	id, err := s.Proofs.Begin(r.Context(), Record{AccountID: accountID, LinkID: link.ID, Host: link.Ref.Host, HostLeagueID: link.Ref.LeagueID,
		Season: link.Ref.Season, Kind: kindLineup, Week: mv.Week, Digest: sum, Plan: planJSON, Body: body})
	if errors.Is(err, ErrUsed) {
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, tokenUsedWords, nil)
		return
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "hostmoves: begin", err)
		return
	}
	// From here the move may have left: nothing the request's end cancels.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), afterSend)
	defer cancel()
	ans, err := s.Writer.SetLineup(ctx, p.cookies, set)
	if err != nil {
		s.keep(ctx, accountID, id, Answer{Outcome: OutcomeNotSent})
		s.Log.Warn("hostmoves: not sent", "account", accountID, "move", id, "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, notSentWords, nil)
		return
	}
	kept := s.settle(ctx, p.cookies, set, ans)
	s.keep(ctx, accountID, id, kept)
	s.Log.Info("hostmoves: move", "account", accountID, "move", id, "outcome", kept.Outcome, "status", ans.Status,
		"reason", kept.HostReason, "read_back", kept.ReadBack)
	httpx.WriteOK(w, r, http.StatusOK, result(kept, id, hostURL(link)))
}

// settle is what a sent move came to: a refusal is ESPN's, anything else
// is read back, done when the host's lineup holds the move and pending
// when it does not or the read fails. Never a retry.
func (s *Service) settle(ctx context.Context, cookies espn.Cookies, set espn.LineupSet, ans espn.WriteAnswer) Answer {
	a := Answer{HostStatus: ans.Status, HostBody: ans.Body}
	if ans.Outcome == espn.WriteRefused {
		a.Outcome, a.HostReason, a.HostWords, a.ReadBack = OutcomeRefused, ans.Refusal.Type, ans.Refusal.Message, readNotRead
		return a
	}
	matched, err := s.Writer.Applied(ctx, cookies, set)
	switch {
	case err != nil:
		s.Log.Warn("hostmoves: read back", "err", err)
		a.Outcome, a.ReadBack = OutcomePending, readNotRead
	case matched:
		a.Outcome, a.ReadBack = OutcomeDone, readMatched
	default:
		a.Outcome, a.ReadBack = OutcomePending, readNotMatched
	}
	return a
}

// keep writes what the move came to; a failure is logged, the answer
// still goes to the member.
func (s *Service) keep(ctx context.Context, accountID, id uuid.UUID, a Answer) {
	if err := s.Proofs.Answered(ctx, accountID, id, a, s.Now()); err != nil {
		s.Log.Error("hostmoves: keep the answer", "account", accountID, "move", id, "err", err)
	}
}

// result is the member's answer for what the move came to.
func result(a Answer, id uuid.UUID, href string) apitypes.HostMoveResult {
	out := apitypes.HostMoveResult{HostUrl: href, MoveId: &id}
	switch a.Outcome {
	case OutcomeDone:
		out.Outcome, out.Sentence = apitypes.HostMoveResultOutcomeDone, doneWords
	case OutcomeRefused:
		out.Outcome, out.Sentence = apitypes.HostMoveResultOutcomeRefused, refusedWords
		if a.HostWords != "" {
			words := a.HostWords
			out.HostWords = &words
		}
	default:
		out.Outcome, out.Sentence = apitypes.HostMoveResultOutcomePending, pendingWords
	}
	return out
}

// list is the member's own moves on the league, the last 20.
func (s *Service) list(w http.ResponseWriter, r *http.Request) {
	link, ok := s.link(w, r)
	if !ok {
		return
	}
	kept, err := s.Proofs.List(r.Context(), auth.AccountID(r), link.ID)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "hostmoves: list", err)
		return
	}
	out := make([]apitypes.HostMove, 0, len(kept))
	for _, k := range kept {
		out = append(out, apitypes.HostMove{Id: k.ID, Kind: apitypes.HostMoveKind(k.Kind), Week: k.Week, Sentence: k.Sentence,
			Outcome: apitypes.HostMoveOutcome(k.Outcome), HostWords: k.HostWords, CreatedAt: k.CreatedAt, AnsweredAt: k.AnsweredAt})
	}
	httpx.WriteOK(w, r, http.StatusOK, out)
}
