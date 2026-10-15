package espnhost

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/season"
)

// The sentences of a session kept unproven.
const (
	keptFor        = "We keep your session for the day a private league or a move needs it."
	noLeaguesWords = "ESPN lists no football league for your account this season. We keep your session, and your leagues appear here when ESPN lists them."
)

// verified is what a connect learned: the member's leagues, which of them
// the public reads (for the ones checked), and whether a league the public
// cannot read was read with the cookies, which proves them.
type verified struct {
	list   []espn.MyLeague
	public map[string]bool
	proven bool
}

// connect keeps the two cookies sealed once ESPN reads the member's
// league list with them: proven (201) when one of their leagues the
// public cannot read reads with them too, unproven (200, with a sentence
// saying why it is kept) when every league is public or ESPN lists none.
func (s *Service) connect(w http.ResponseWriter, r *http.Request) {
	if !s.Enabled {
		off(w, r)
		return
	}
	var in apitypes.ESPNConnectInput
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	cookies, errs := checkConnect(in)
	if errs != nil {
		httpx.WriteInvalid(w, r, errs)
		return
	}
	ctx, accountID, now := r.Context(), auth.AccountID(r), s.Now()
	n, err := s.Store.Refusals(ctx, accountID, Host, now.Add(-refusalWindow))
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "espnhost: refusals", err)
		return
	}
	if n >= maxRefusals {
		httpx.WriteError(w, r, http.StatusLocked, httpx.CodeForbidden, pausedWords, nil)
		return
	}
	v, err := s.verify(ctx, cookies, season.Of(now))
	if errors.Is(err, espn.ErrSignedOut) {
		if rerr := s.Store.Refused(ctx, accountID, Host, now); rerr != nil {
			s.Log.Warn("espnhost: keep refusal", "err", rerr)
		}
		httpx.WriteError(w, r, http.StatusUnprocessableEntity, httpx.CodeInvalid, refusedWords, nil)
		return
	}
	if err != nil {
		s.Log.Warn("espnhost: connect", "err", err)
		httpx.WriteError(w, r, http.StatusBadGateway, httpx.CodeUnavailable, notAnswering, nil)
		return
	}
	s.keep(w, r, cookies, v)
}

// keep seals the cookies and answers the connection and the leagues.
func (s *Service) keep(w http.ResponseWriter, r *http.Request, cookies espn.Cookies, v verified) {
	ctx, accountID, now := r.Context(), auth.AccountID(r), s.Now()
	sealed, err := Seal(s.Vault, accountID, cookies)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "espnhost: seal", err)
		return
	}
	put, status := s.Store.Put, http.StatusCreated
	if !v.proven {
		put, status = s.Store.PutUnproven, http.StatusOK
	}
	conn, err := put(ctx, accountID, Host, sealed, now)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "espnhost: keep connection", err)
		return
	}
	views, ok := s.views(w, r, v.list, v.public)
	if !ok {
		return
	}
	out := apitypes.HostConnected{Connection: hosts.View(conn), Leagues: views}
	if !v.proven {
		note := unprovenWords(len(v.list), v.public)
		out.Note = &note
	}
	httpx.WriteOK(w, r, status, out)
}

// verify reads the member's league list with the cookies (a refusal there
// is the cookies refused), marks each listed league public or private,
// and reads the first private one with the cookies, which is what proves
// espn_s2: a SWID alone is no proof, since any public league answers its
// members' SWIDs. It logs counts, never a cookie or the SWID.
func (s *Service) verify(ctx context.Context, c espn.Cookies, yr int) (verified, error) {
	list, err := s.Client.MyLeagues(ctx, c, yr)
	if err != nil {
		return verified{}, err
	}
	v := verified{list: list, public: s.publicity(ctx, list, yr)}
	for _, l := range list {
		if public, checked := v.public[l.LeagueID]; !checked || public {
			continue
		}
		if _, err := s.Client.Read(ctx, l.LeagueID, yr, &c); err != nil {
			return verified{}, err
		}
		v.proven = true
		break
	}
	s.Log.Info("espnhost: connect probes", "listed", len(list), "probed", len(v.public), "public", countTrue(v.public), "proven", v.proven)
	return v, nil
}

func countTrue(m map[string]bool) int {
	n := 0
	for _, v := range m {
		if v {
			n++
		}
	}
	return n
}

// unprovenWords is the sentence for a session kept unproven: how many
// leagues ESPN lists, how many of them were checked public, and why the
// session is kept. It never says more were checked than were.
func unprovenWords(listed int, public map[string]bool) string {
	checked := len(public)
	switch {
	case listed == 0:
		return noLeaguesWords
	case checked == 0:
		return fmt.Sprintf("ESPN lists %s for you this season. ESPN did not answer whether they are public just now. %s", leagues(listed), keptFor)
	case checked < listed:
		verb := "are"
		if checked == 1 {
			verb = "is"
		}
		return fmt.Sprintf("ESPN lists %s for you this season, and the %d we checked %s public. %s", leagues(listed), checked, verb, keptFor)
	case listed == 1:
		return "ESPN lists 1 league for you this season, a public one. " + keptFor
	}
	return fmt.Sprintf("ESPN lists %s for you this season, all public. %s", leagues(listed), keptFor)
}

// leagues is a count of leagues: "1 league", "3 leagues".
func leagues(n int) string {
	if n == 1 {
		return "1 league"
	}
	return fmt.Sprintf("%d leagues", n)
}
