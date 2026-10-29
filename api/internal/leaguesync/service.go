package leaguesync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/leagues"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// Rate limits, per account: a page reads its league once on load and
// once a minute while open; a refresh is a deliberate tap.
const (
	limitReadPerMinute    = 120
	limitAttachPerMinute  = 20
	limitDetachPerMinute  = 30
	limitRefreshPerHour   = 30
	maxMovesShown         = 40
	maxSavedLeagueNameLen = 60
)

// Links is the part of Store the handlers use.
type Links interface {
	Find(ctx context.Context, accountID uuid.UUID, ref Ref) (Link, bool, error)
	Save(ctx context.Context, l Link, many bool) (Link, error)
	Get(ctx context.Context, accountID, id uuid.UUID) (Link, error)
	Attached(ctx context.Context, accountID uuid.UUID) ([]Attached, error)
	Detach(ctx context.Context, accountID, id uuid.UUID) error
	Restore(ctx context.Context, accountID, id uuid.UUID, many bool) (Link, error)
	Touch(ctx context.Context, accountID, id uuid.UUID, at time.Time) error
	Linked(ctx context.Context, ref Ref) (bool, error)
	LinksOf(ctx context.Context, ref Ref) ([]Link, error)
}

// SavedLeagues is the part of leagues.Store an attach writes: the saved
// league a mock reruns from.
type SavedLeagues interface {
	Get(ctx context.Context, accountID, id uuid.UUID) (apitypes.League, error)
	Create(ctx context.Context, accountID uuid.UUID, in apitypes.LeagueInput) (apitypes.League, error)
	Replace(ctx context.Context, accountID, id uuid.UUID, in apitypes.LeagueInput) (apitypes.League, error)
	Delete(ctx context.Context, accountID, id uuid.UUID) error
	// KeepScoring sets kicking and defense rules alone inside a league's
	// custom scoring, reporting whether it wrote.
	KeepScoring(ctx context.Context, accountID, id uuid.UUID, rules map[string]float64) (bool, error)
}

// BoardSource values our board for a league. *draftroom.Boards
// implements it.
type BoardSource interface {
	For(ctx context.Context, s apitypes.LeagueSettings) (boards.Board, error)
}

// Players is each host's directory. *Directory implements it.
type Players interface {
	For(ctx context.Context, host string, season int, need []string) (map[string]HostPlayer, error)
}

// Service serves the league sync routes.
type Service struct {
	Hosts     Hosts
	Poller    *Poller
	Admission *Admission
	Players   Players
	Links     Links
	Saved     SavedLeagues
	Boards    BoardSource
	// Entitlements answers many_leagues: one live league is free.
	Entitlements Checker
	// FFPC is the FFPC host when it is set up (HOST_CREDENTIALS_KEY), nil
	// otherwise; it is also among Hosts, which reads it on the poll.
	FFPC *FFPC
	// ESPN reads a public ESPN league's scoring for the import.
	ESPN ESPNLeagues
	// Selection keeps the site's context and Accounts answers the Account
	// it changes (PUT /me/league).
	Selection Selector
	Accounts  AccountViewer

	Now func() time.Time
	Log *slog.Logger

	// chances keeps each read's playoff chance (Lane 298).
	chances chanceCache
}

// Routes is every route this package serves.
func (s *Service) Routes() []httpx.Route {
	read := httpx.PerMinute(limitReadPerMinute)
	return []httpx.Route{
		{Method: http.MethodPost, Path: "/leagues/import-scoring", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitAttachPerMinute), Handler: s.importScoring},
		{Method: http.MethodPost, Path: "/leagues/attach/preview", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitAttachPerMinute), Handler: s.preview},
		{Method: http.MethodPost, Path: "/leagues/attach", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitAttachPerMinute), Handler: s.attach},
		{Method: http.MethodGet, Path: "/leagues/attached", Access: httpx.SignedIn, Limit: read, Handler: s.attached},
		{Method: http.MethodDelete, Path: "/leagues/attached/{id}", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitDetachPerMinute), Handler: s.detach},
		{Method: http.MethodPost, Path: "/leagues/attached/{id}/restore", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitDetachPerMinute), Handler: s.restore},
		{Method: http.MethodGet, Path: "/leagues/attached/{id}/sync", Access: httpx.SignedIn, Limit: read, Handler: s.sync},
		{Method: http.MethodPost, Path: "/leagues/attached/{id}/refresh", Access: httpx.SignedIn, Limit: httpx.PerHour(limitRefreshPerHour), Handler: s.refresh},
		{Method: http.MethodPut, Path: "/me/league", Access: httpx.SignedIn, Limit: httpx.PerMinute(limitSelectPerMinute), Handler: s.selectLeague},
	}
}

// HostWords is a host's name as a sentence says it.
func HostWords(host string) string {
	switch host {
	case HostMFL:
		return "MyFantasyLeague"
	case HostFFPC:
		return "FFPC"
	case HostYahoo:
		return "Yahoo"
	case HostESPN:
		return "ESPN"
	}
	return "Sleeper"
}

// Field names and the drafter's words for them.
const (
	fieldLink = "link"
	fieldMe   = "me"
	fieldHost = "host"

	seatWords     = "Give your Sleeper username, or pick your team"
	pickTeamWords = "Pick your team from the list"
	// espnPrivateFollowWords sends a private ESPN league to the account
	// page, where connecting ESPN reads it as the member.
	espnPrivateFollowWords = "This ESPN league is private. Connect ESPN first, then pick it from your ESPN list"
)

// linkWords asks for a link from the hosts a link may name here: ESPN
// only while it is switched on.
func (s *Service) linkWords() string {
	if _, on := s.Hosts.ByKey(HostESPN); on {
		return "Paste your league's link from Sleeper, MyFantasyLeague or ESPN"
	}
	return "Paste your league's link from Sleeper or MyFantasyLeague"
}

// writeHostError says what went wrong reading the league, in our words.
func (s *Service) writeHostError(w http.ResponseWriter, r *http.Request, host string, err error) {
	if writeMemberError(w, r, host, err) {
		return
	}
	switch {
	case errors.Is(err, ErrNotALink):
		httpx.WriteInvalid(w, r, map[string]string{fieldLink: s.linkWords()})
	case errors.Is(err, ErrNotFound):
		httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound, HostWords(host)+" has no league at that link", nil)
	case errors.Is(err, ErrPrivate) && host == HostESPN:
		httpx.WriteError(w, r, http.StatusUnprocessableEntity, httpx.CodeInvalid, espnPrivateFollowWords, nil)
	case errors.Is(err, ErrPrivate):
		httpx.WriteError(w, r, http.StatusUnprocessableEntity, httpx.CodeInvalid,
			"This league is private on "+HostWords(host)+". We follow public leagues today", nil)
	case errors.Is(err, ErrTooManyNew):
		httpx.WriteError(w, r, http.StatusTooManyRequests, httpx.CodeRateLimited,
			fmt.Sprintf("You have looked up %d new leagues this hour. Attach one of them, or try again later", NewLeaguesPerHour), nil)
	case errors.Is(err, ErrBusy):
		httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeUnavailable,
			HostWords(host)+" is busy with other leagues right now. Try again in a minute", nil)
	case errors.Is(err, ErrUnavailable):
		s.Log.Warn("leaguesync: host", "host", host, "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable,
			HostWords(host)+" is not answering right now. Try again in a moment", nil)
	default:
		httpx.WriteInternal(w, r, s.Log, "leaguesync", err)
	}
}

func hostKey(h *apitypes.LeagueHost) string {
	if h == nil {
		return ""
	}
	return string(*h)
}

// resolve is the host and league the request names, or an answer.
func (s *Service) resolve(w http.ResponseWriter, r *http.Request, host *apitypes.LeagueHost, link string) (Host, Ref, bool) {
	if host != nil && !host.Valid() {
		httpx.WriteInvalid(w, r, map[string]string{fieldHost: s.linkWords()})
		return nil, Ref{}, false
	}
	h, ref, err := s.Hosts.Resolve(hostKey(host), link)
	if err != nil {
		s.writeHostError(w, r, hostKey(host), err)
		return nil, Ref{}, false
	}
	return h, ref, true
}

func (s *Service) preview(w http.ResponseWriter, r *http.Request) {
	var in apitypes.AttachPreviewInput
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	h, ref, ok := s.resolve(w, r, in.Host, in.Link)
	if !ok {
		return
	}
	if pickedFromList(h.Key()) {
		// A league read as a member is picked from their own list.
		httpx.WriteInvalid(w, r, map[string]string{fieldLink: wordsFor(h.Key()).pick})
		return
	}
	read, err := s.readFor(r.Context(), auth.AccountID(r), ref)
	if err != nil {
		s.writeHostError(w, r, ref.Host, err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, apitypes.AttachPreview{
		Host: apitypes.LeagueHost(ref.Host), HostLeagueId: ref.LeagueID, Season: read.Season, Name: read.Name,
		Teams: standings(read.Teams), SeatByUsername: h.Key() == HostSleeper,
	})
}

// readFor is the league for a preview or an attach. A league this
// process holds or some account has attached reads as any view does; one
// nobody has attached is admitted first (Admission), and its read waits
// on the caller, who can cancel it.
func (s *Service) readFor(ctx context.Context, accountID uuid.UUID, ref Ref) (Read, error) {
	if !s.Poller.Holds(ref) {
		linked, err := s.Links.Linked(ctx, ref)
		if err != nil {
			return Read{}, err
		}
		if !linked {
			release, err := s.Admission.Admit(accountID, ref)
			if err != nil {
				return Read{}, err
			}
			defer release()
		}
	}
	return s.Poller.Read(ctx, ref)
}

// load is one of the account's links, or an answer.
func (s *Service) load(w http.ResponseWriter, r *http.Request) (Link, bool) {
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return Link{}, false
	}
	link, err := s.Links.Get(r.Context(), auth.AccountID(r), id)
	if errors.Is(err, ErrLinkNotFound) {
		httpx.WriteNotFound(w, r)
		return Link{}, false
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "leaguesync: get", err)
		return Link{}, false
	}
	return link, true
}

func (s *Service) sync(w http.ResponseWriter, r *http.Request) {
	s.answerRead(w, r, s.Poller.Read)
}

func (s *Service) refresh(w http.ResponseWriter, r *http.Request) {
	s.answerRead(w, r, s.Poller.Refresh)
}

func (s *Service) answerRead(w http.ResponseWriter, r *http.Request, readFn func(context.Context, Ref) (Read, error)) {
	link, ok := s.load(w, r)
	if !ok {
		return
	}
	read, err := readFn(r.Context(), link.Ref)
	if err != nil {
		s.writeHostError(w, r, link.Ref.Host, err)
		return
	}
	s.answer(w, r, http.StatusOK, link, read)
}

// answer writes the league's view for the link's seat.
func (s *Service) answer(w http.ResponseWriter, r *http.Request, status int, link Link, read Read) {
	view, err := s.view(r.Context(), link, read)
	if errors.Is(err, ErrUnavailable) {
		// No player directory yet: say the host is not answering rather
		// than show a league of players we cannot name.
		s.writeHostError(w, r, link.Ref.Host, err)
		return
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "leaguesync: view", err)
		return
	}
	if link.LastReadAt != nil && link.LastReadAt.Equal(read.ReadAt) {
		httpx.WriteOK(w, r, status, view)
		return
	}
	if err := s.Links.Touch(r.Context(), link.AccountID, link.ID, read.ReadAt); err != nil {
		s.Log.Warn("leaguesync: touch", "link", link.ID, "err", err)
	}
	httpx.WriteOK(w, r, status, view)
}

func (s *Service) attached(w http.ResponseWriter, r *http.Request) {
	list, err := s.Links.Attached(r.Context(), auth.AccountID(r))
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "leaguesync: attached", err)
		return
	}
	out := make([]apitypes.AttachedLeague, 0, len(list))
	for _, a := range list {
		p := a.Phase
		out = append(out, apitypes.AttachedLeague{
			Id: a.ID, Host: apitypes.LeagueHost(a.Ref.Host), HostLeagueId: a.Ref.LeagueID, Season: a.Season,
			Name: a.Name, RosterId: a.RosterID, TeamName: a.TeamName, Standing: standingOf(a.Teams, a.RosterID),
			AttachedAt: a.AttachedAt, LastReadAt: a.LastReadAt, Phase: p.Phase, PhaseBasis: p.Basis, DraftAt: p.DraftAt, PlayoffStartWeek: p.PlayoffStartWeek, WaiversOpen: p.WaiversOpen,
		})
	}
	httpx.WriteOK(w, r, http.StatusOK, out)
}

func (s *Service) detach(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return
	}
	err := s.Links.Detach(r.Context(), auth.AccountID(r), id)
	if errors.Is(err, ErrLinkNotFound) {
		httpx.WriteNotFound(w, r)
		return
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "leaguesync: detach", err)
		return
	}
	httpx.WriteOK(w, r, http.StatusOK, nil)
}

// savedSettings is the saved league a link made, nil when it has none
// or it was deleted from the setup page. Its kicking and defense rules are
// the host's: the rules the read states that differ are set in the saved
// league (KeepScoring, which touches nothing else), so a league saved
// before they were kept, or whose host changed them, scores its kickers
// and defenses as the host does. That write is a repair: when it fails it
// is logged, the read answers the host's rules, and the next read writes
// them.
func (s *Service) savedSettings(ctx context.Context, link Link, read Read) (*apitypes.LeagueSettings, error) {
	if link.LeagueID == nil {
		return nil, nil
	}
	l, err := s.Saved.Get(ctx, link.AccountID, *link.LeagueID)
	if errors.Is(err, leagues.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	settings, stated := hostKickDefense(l.Settings, read)
	if len(stated) == 0 {
		return &settings, nil
	}
	if _, err := s.Saved.KeepScoring(ctx, link.AccountID, l.Id, stated); err != nil {
		s.Log.Warn("leaguesync: keep the host's kicking and defense rules", "league", l.Id, "err", err)
	}
	return &settings, nil
}

// hostKickDefense is the saved settings with the kicking and defense rules
// the read states taken from it where they differ, and those rules. Only
// a rule the host's read states is taken (a read kept before these rules
// existed states none), never from a failed read, and the board's rules
// stay as saved.
func hostKickDefense(saved apitypes.LeagueSettings, read Read) (apitypes.LeagueSettings, map[string]float64) {
	if read.Failed || saved.Scoring.Custom == nil {
		return saved, nil
	}
	kept := scoring.ToMap(*saved.Scoring.Custom)
	stated := map[string]float64{}
	for key := range scoring.KickDefenseKeys() {
		if v, ok := read.Scoring.Rules[key]; ok && kept[key] != v {
			kept[key], stated[key] = v, v
		}
	}
	if len(stated) == 0 {
		return saved, nil
	}
	rules, err := scoring.FromMap(kept)
	if err != nil {
		return saved, nil
	}
	out := saved
	out.Scoring.Custom = &rules
	return out, stated
}

// restore undoes a detach: the league is followed again with the seat
// and the saved league it had.
func (s *Service) restore(w http.ResponseWriter, r *http.Request) {
	id, ok := httpx.PathUUID(w, r, "id")
	if !ok {
		return
	}
	ctx := r.Context()
	accountID := auth.AccountID(r)
	many, err := s.Entitlements.Can(ctx, accountID, entitlements.ManyLeagues, s.Now())
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "leaguesync: can many leagues", err)
		return
	}
	_, err = s.Links.Restore(ctx, accountID, id, many)
	switch {
	case errors.Is(err, ErrLinkNotFound):
		httpx.WriteNotFound(w, r)
	case writeCapError(w, r, err):
	case err != nil:
		httpx.WriteInternal(w, r, s.Log, "leaguesync: restore", err)
	default:
		httpx.WriteOK(w, r, http.StatusOK, nil)
	}
}
