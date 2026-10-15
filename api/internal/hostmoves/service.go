// Package hostmoves makes a move on a host with the member's stored
// session, after the member confirms it on our screen (spec 2026-10-15
// §10.2; docs/research/2026-10-15-host-writes-design.md §6): one
// host-neutral route plans the move in words with a confirm token, a
// second makes it once with that token. Two moves today, both on ESPN: a
// lineup set (behind HOST_WRITES_ESPN_LINEUP) and a claim, an add with
// its drop and the bid where the league bids (behind
// HOST_WRITES_ESPN_CLAIM), each also open to the accounts on its allow
// list. Every move is kept as its proof; a cookie never is, nor is a move
// retried on its own.
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
	maxBid             = 100000
	// sendBudget bounds the send and the read-back once a move leaves,
	// cut loose from the request so a closed tab never loses them.
	sendBudget = 30 * time.Second
	// keepBudget bounds the proof's last write, on its own context, so a
	// slow ESPN never leaves a row at sending.
	keepBudget = 5 * time.Second
)

// The move kinds, as the allow list and the proof name them.
const (
	kindLineup = string(apitypes.HostMoveInputKindLineup)
	kindClaim  = string(apitypes.HostMoveInputKindClaim)
)

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
	ESPNLineup bool
	// ESPNClaim is HOST_WRITES_ESPN_CLAIM, the same for a claim.
	ESPNClaim   bool
	Links       Links
	Connections Connections
	Member      Member
	Writer      Writer
	Claims      Claims
	Proofs      Proofs
	Signer      Signer
	// SendBudget and KeepBudget are sendBudget and keepBudget when zero.
	SendBudget time.Duration
	KeepBudget time.Duration
	Now        func() time.Time
	Log        *slog.Logger
}

func orDefault(d, fallback time.Duration) time.Duration {
	if d > 0 {
		return d
	}
	return fallback
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
	open, note, err := s.open(ctx, accountID, host, apitypes.HostMoveInputKindLineup)
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

// ClaimMove says whether the account may claim on the host from our
// screen, and the sentence when a claim waits on the member. The waivers
// screen's answer carries it.
func (s *Service) ClaimMove(ctx context.Context, accountID uuid.UUID, host string) (apitypes.WaiverMoves, error) {
	open, note, err := s.open(ctx, accountID, host, apitypes.HostMoveInputKindClaim)
	out := apitypes.WaiverMoves{Claim: apitypes.WaiverMovesClaimUnavailable}
	if err != nil {
		return out, err
	}
	if open {
		out.Claim = apitypes.WaiverMovesClaimAvailable
	}
	if note != "" {
		out.Note = &note
	}
	return out, nil
}

// switchOn is the kind's switch on ESPN.
func (s *Service) switchOn(kind apitypes.HostMoveInputKind) bool {
	if kind == apitypes.HostMoveInputKindClaim {
		return s.ESPNClaim
	}
	return s.ESPNLineup
}

// open reports whether a move of the kind is open to the account on the
// host: the host has a write path, the kind's switch or its allow list
// lets the account make it, and the account's connection is connected and
// agreed to words that name the moves. When it is closed on the member's
// side, note says what to do.
func (s *Service) open(ctx context.Context, accountID uuid.UUID, host string, kind apitypes.HostMoveInputKind) (bool, string, error) {
	if host != espnhost.Host || !s.ESPNOpen || (kind == apitypes.HostMoveInputKindClaim && s.Claims == nil) {
		return false, "", nil
	}
	if !s.switchOn(kind) {
		allowed, err := s.Proofs.Allowed(ctx, accountID, host, string(kind))
		if err != nil || !allowed {
			return false, "", err
		}
	}
	words := wordsFor(kind)
	conn, err := s.Connections.Get(ctx, accountID, host)
	switch {
	case errors.Is(err, hosts.ErrNotConnected):
		return false, "", nil
	case err != nil:
		return false, "", err
	case conn.Status != hosts.StatusConnected:
		return false, words.reconnect, nil
	case conn.ConsentVersion < hosts.ESPNConsentVersion:
		return false, words.reconsent, nil
	}
	return true, "", nil
}

// checkMove checks the move's shape before anything is read: a lineup's
// changes, or a claim's add, drop and bid, never both.
func checkMove(mv apitypes.HostMoveInput) bool {
	if mv.Week < 1 || mv.Week > maxWeek {
		return false
	}
	switch mv.Kind {
	case apitypes.HostMoveInputKindLineup:
		return mv.Claim == nil && checkChanges(mv.Changes)
	case apitypes.HostMoveInputKindClaim:
		return len(mv.Changes) == 0 && mv.Claim != nil && checkClaim(*mv.Claim)
	}
	return false
}

func checkChanges(changes []apitypes.HostMoveChange) bool {
	if len(changes) == 0 || len(changes) > maxChanges {
		return false
	}
	for _, c := range changes {
		if _, ok := espnSlot(c.Slot); !ok || !hostID.MatchString(c.In) || (c.Out != nil && !hostID.MatchString(*c.Out)) {
			return false
		}
	}
	return true
}

func checkClaim(c apitypes.HostClaim) bool {
	switch {
	case !hostID.MatchString(c.Add):
		return false
	case c.Drop != nil && (!hostID.MatchString(*c.Drop) || *c.Drop == c.Add):
		return false
	case c.Bid != nil && (*c.Bid < 0 || *c.Bid > maxBid):
		return false
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

// prepared is a move checked against a fresh read (a lineup or a claim),
// or the sentence for why it is unavailable here (unavailable is "" when
// it is ready).
type prepared struct {
	lineup      *lineupPlan
	claim       *claimPlan
	cookies     espn.Cookies
	unavailable string
}

// sentence is the move in words.
func (p prepared) sentence() string {
	if p.claim != nil {
		return p.claim.sentence
	}
	if p.lineup != nil {
		return p.lineup.sentence
	}
	return ""
}

// errSilent is a read of the host that did not answer while planning.
var errSilent = errors.New("hostmoves: the host did not answer")

// prepare checks the move is open to the account, reads the league as
// the member and plans the move on their own team. It answers a refusal
// itself and reports false.
func (s *Service) prepare(w http.ResponseWriter, r *http.Request, link leaguesync.Link, mv apitypes.HostMoveInput) (prepared, bool) {
	ctx, accountID := r.Context(), auth.AccountID(r)
	words := wordsFor(mv.Kind)
	open, note, err := s.open(ctx, accountID, link.Ref.Host, mv.Kind)
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
	if unavailable, answered := s.readRefusal(w, r, err, words); answered || unavailable != "" {
		return prepared{unavailable: unavailable}, unavailable != ""
	}
	// The read carries the teams (view=mTeam) as ESPN answers them to these
	// cookies: the guard needs the stored SWID among the owners of the team
	// the attached league names as the member's, or the move is unavailable.
	out := prepared{cookies: cookies}
	if mv.Kind == apitypes.HostMoveInputKindClaim {
		var plan claimPlan
		plan, err = planClaim(l, cookies.SWID, link.RosterID, mv, func(id string) (espn.Availability, error) {
			a, err := s.Claims.Availability(ctx, cookies, link.Ref.LeagueID, link.Ref.Season, l.ScoringPeriod, id)
			return a, availabilityRefusal(err, words)
		})
		out.claim = &plan
	} else {
		var plan lineupPlan
		plan, err = planLineup(l, cookies.SWID, link.RosterID, mv)
		out.lineup = &plan
	}
	if !s.planRefusal(w, r, err) {
		return prepared{}, false
	}
	var ref *refusal
	if errors.As(err, &ref) && ref.unavailable {
		return prepared{unavailable: ref.words}, true
	}
	return out, true
}

// readRefusal is the reading of the league as the member: the sentence
// for a move unavailable here, or an answer it wrote itself.
func (s *Service) readRefusal(w http.ResponseWriter, r *http.Request, err error, words kindWords) (string, bool) {
	switch {
	case err == nil:
		return "", false
	case errors.Is(err, hosts.ErrNotConnected):
		return offWords, false
	case errors.Is(err, espnhost.ErrReconnect), errors.Is(err, espn.ErrSignedOut):
		return words.reconnect, false
	case errors.Is(err, espn.ErrPrivate):
		return words.notYourTeam, false
	}
	s.Log.Warn("hostmoves: read the league", "account", auth.AccountID(r), "err", err)
	httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, notAnsweringWord, nil)
	return "", true
}

// availabilityRefusal is a failed read of a claim's add: the session
// refused is unavailable, anything else the host not answering.
func availabilityRefusal(err error, words kindWords) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, espn.ErrSignedOut):
		return &refusal{words: words.reconnect, cause: err, unavailable: true}
	case errors.Is(err, espn.ErrPrivate):
		return &refusal{words: words.notYourTeam, cause: err, unavailable: true}
	}
	return errors.Join(errSilent, err)
}

// planRefusal answers a plan refused before anything is sent: 422 in the
// member's words, 502 for a host that did not answer. A refusal that
// makes the move unavailable, and no refusal, answer nothing and report
// true.
func (s *Service) planRefusal(w http.ResponseWriter, r *http.Request, err error) bool {
	accountID := auth.AccountID(r)
	var ref *refusal
	switch {
	case err == nil:
		return true
	case errors.As(err, &ref) && ref.unavailable:
		s.Log.Info("hostmoves: unavailable", "account", accountID)
		return true
	case errors.As(err, &ref):
		s.Log.Info("hostmoves: plan refused", "account", accountID, "why", ref.cause.Error())
		httpx.WriteError(w, r, http.StatusUnprocessableEntity, httpx.CodeInvalid, ref.words, nil)
	case errors.Is(err, errSilent):
		s.Log.Warn("hostmoves: read the player", "account", accountID, "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, notAnsweringWord, nil)
	default:
		httpx.WriteInternal(w, r, s.Log, "hostmoves: plan", err)
	}
	return false
}

// hostURL is the host's page for the move: the waivers for a claim, the
// lineup otherwise.
func hostURL(link leaguesync.Link, kind apitypes.HostMoveInputKind) string {
	page := inseason.LineupPage
	if kind == apitypes.HostMoveInputKindClaim {
		page = inseason.WaiversPage
	}
	return inseason.HostURL(link.Ref, link.RosterID, page)
}

// plan answers the move in words with its confirm token; nothing is sent.
func (s *Service) plan(w http.ResponseWriter, r *http.Request) {
	var mv apitypes.HostMoveInput
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &mv) {
		return
	}
	if !checkMove(mv) {
		httpx.WriteInvalid(w, r, map[string]string{fieldMove: wordsFor(mv.Kind).form})
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
	out := apitypes.HostMovePlan{Status: apitypes.HostMovePlanStatusUnavailable, Sentence: p.unavailable, HostUrl: hostURL(link, mv.Kind)}
	if p.unavailable == "" {
		expires := s.Now().Add(ConfirmFor).UTC().Truncate(time.Second)
		token, err := s.Signer.Sign(auth.AccountID(r), link.ID, mv, expires)
		if err != nil {
			httpx.WriteInternal(w, r, s.Log, "hostmoves: sign", err)
			return
		}
		out.Status, out.Sentence, out.Confirm, out.ExpiresAt = apitypes.HostMovePlanStatusReady, p.sentence(), &token, &expires
		if p.claim != nil {
			out.Bid = p.claim.bid
		}
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
	words := wordsFor(in.Move.Kind)
	if !checkMove(in.Move) || in.Confirm == "" || len(in.Confirm) > maxConfirm {
		httpx.WriteInvalid(w, r, map[string]string{fieldMove: words.form})
		return
	}
	link, ok := s.link(w, r)
	if !ok {
		return
	}
	accountID := auth.AccountID(r)
	sum, err := s.Signer.Verify(in.Confirm, accountID, link.ID, in.Move, s.Now())
	if err != nil {
		say := tokenOtherWords
		if errors.Is(err, ErrTokenExpired) {
			say = tokenExpiredWords
		}
		httpx.WriteError(w, r, http.StatusBadRequest, httpx.CodeInvalid, say, map[string]string{fieldConfirm: say})
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
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, words.used, nil)
		return
	}
	p, ok := s.prepare(w, r, link, in.Move)
	if !ok {
		return
	}
	if p.unavailable != "" {
		httpx.WriteOK(w, r, http.StatusOK, apitypes.HostMoveResult{Outcome: apitypes.HostMoveResultOutcomeUnavailable, Sentence: p.unavailable,
			HostUrl: hostURL(link, in.Move.Kind)})
		return
	}
	s.send(w, r, link, in.Move, sum, p)
}

// planRecord is a lineup's plan as the proof keeps it: the words and the
// items.
type planRecord struct {
	Sentence string            `json:"sentence"`
	Team     int               `json:"team"`
	Period   int               `json:"scoring_period"`
	Items    []espn.LineupItem `json:"items"`
}

// outgoing is the move as it leaves: its body, its plan as the proof
// keeps it, the one send and what it came to.
type outgoing struct {
	body   []byte
	record any
	send   func(ctx context.Context) (espn.WriteAnswer, error)
	settle func(ctx context.Context, ans espn.WriteAnswer) (Answer, string)
}

// outgoingOf is the prepared move ready to leave.
func (s *Service) outgoingOf(p prepared) (outgoing, error) {
	if p.claim != nil {
		c := *p.claim
		body, err := c.set.Body()
		return outgoing{body: body, record: c.record(),
			send: func(ctx context.Context) (espn.WriteAnswer, error) { return s.Claims.Claim(ctx, p.cookies, c.set) },
			settle: func(ctx context.Context, ans espn.WriteAnswer) (Answer, string) {
				return s.settleClaim(ctx, p.cookies, c, ans)
			}}, err
	}
	set := p.lineup.set
	body, err := set.Body()
	return outgoing{body: body, record: planRecord{Sentence: p.lineup.sentence, Team: set.Team(), Period: set.Period(), Items: set.Items()},
		send: func(ctx context.Context) (espn.WriteAnswer, error) { return s.Writer.SetLineup(ctx, p.cookies, set) },
		settle: func(ctx context.Context, ans espn.WriteAnswer) (Answer, string) {
			a := s.settle(ctx, p.cookies, set, ans)
			return a, lineupResultWords(a)
		}}, err
}

// send keeps the move, sends it once and answers what it came to.
func (s *Service) send(w http.ResponseWriter, r *http.Request, link leaguesync.Link, mv apitypes.HostMoveInput, sum []byte, p prepared) {
	accountID := auth.AccountID(r)
	out, err := s.outgoingOf(p)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "hostmoves: body", err)
		return
	}
	planJSON, err := json.Marshal(out.record)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "hostmoves: plan record", err)
		return
	}
	id, err := s.Proofs.Begin(r.Context(), Record{AccountID: accountID, LinkID: link.ID, Host: link.Ref.Host, HostLeagueID: link.Ref.LeagueID,
		Season: link.Ref.Season, Kind: string(mv.Kind), Week: mv.Week, Digest: sum, Plan: planJSON, Body: out.body})
	if errors.Is(err, ErrUsed) {
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, wordsFor(mv.Kind).used, nil)
		return
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "hostmoves: begin", err)
		return
	}
	// From here the move may have left: nothing the request's end cancels.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), orDefault(s.SendBudget, sendBudget))
	defer cancel()
	ans, err := out.send(ctx)
	if err != nil {
		s.keep(r.Context(), accountID, id, Answer{Outcome: OutcomeNotSent})
		s.Log.Warn("hostmoves: not sent", "account", accountID, "move", id, "kind", mv.Kind, "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, notSentWords, nil)
		return
	}
	kept, sentence := out.settle(ctx, ans)
	s.keep(r.Context(), accountID, id, kept)
	if kept.Member == string(espn.MemberMismatched) {
		s.Log.Warn("hostmoves: ESPN named another member on the move", "account", accountID, "move", id)
	}
	s.Log.Info("hostmoves: move", "account", accountID, "move", id, "kind", mv.Kind, "outcome", kept.Outcome, "status", ans.Status,
		"reason", kept.HostReason, "read_back", kept.ReadBack, "member", kept.Member)
	httpx.WriteOK(w, r, http.StatusOK, result(kept, sentence, id, hostURL(link, mv.Kind)))
}

// settle is what a sent lineup came to: a refusal is ESPN's, anything
// else is read back, done when the host's lineup holds the move and
// pending when it does not or the read fails. Never a retry.
func (s *Service) settle(ctx context.Context, cookies espn.Cookies, set espn.LineupSet, ans espn.WriteAnswer) Answer {
	a := Answer{HostStatus: ans.Status, TransactionID: ans.TransactionID, Member: string(ans.Member)}
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

// lineupResultWords is our sentence for what a lineup came to.
func lineupResultWords(a Answer) string {
	switch a.Outcome {
	case OutcomeDone:
		return doneWords
	case OutcomeRefused:
		return refusedWords
	}
	return pendingWords
}

// keep writes what the move came to on its own short deadline, cut loose
// from the request and from the send's budget; a failure is logged, the
// answer still goes to the member.
func (s *Service) keep(parent context.Context, accountID, id uuid.UUID, a Answer) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), orDefault(s.KeepBudget, keepBudget))
	defer cancel()
	if err := s.Proofs.Answered(ctx, accountID, id, a, s.Now()); err != nil {
		s.Log.Error("hostmoves: keep the answer", "account", accountID, "move", id, "err", err)
	}
}

// result is the member's answer for what the move came to.
func result(a Answer, sentence string, id uuid.UUID, href string) apitypes.HostMoveResult {
	out := apitypes.HostMoveResult{HostUrl: href, MoveId: &id, Sentence: sentence, ProcessesAt: processAt(a)}
	switch a.Outcome {
	case OutcomeDone:
		out.Outcome = apitypes.HostMoveResultOutcomeDone
	case OutcomeRefused:
		out.Outcome = apitypes.HostMoveResultOutcomeRefused
		if a.HostWords != "" {
			words := a.HostWords
			out.HostWords = &words
		}
	default:
		out.Outcome = apitypes.HostMoveResultOutcomePending
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
		// A row a crash left at sending is a move that may have been made.
		if k.Outcome == OutcomeSending {
			k.Outcome = OutcomePending
		}
		out = append(out, apitypes.HostMove{Id: k.ID, Kind: apitypes.HostMoveKind(k.Kind), Week: k.Week, Sentence: k.Sentence,
			Outcome: apitypes.HostMoveOutcome(k.Outcome), HostWords: k.HostWords, CreatedAt: k.CreatedAt, AnsweredAt: k.AnsweredAt})
	}
	httpx.WriteOK(w, r, http.StatusOK, out)
}
