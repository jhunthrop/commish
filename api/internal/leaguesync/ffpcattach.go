package leaguesync

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// Words for an FFPC league.
const (
	ffpcPickWords      = "Pick your league from your FFPC list"
	ffpcConnectWords   = "Connect FFPC first: sign in on the league page"
	ffpcSignInWords    = "FFPC signed you out. Sign in to FFPC again to keep reading your league"
	ffpcNotConfigured  = "FFPC leagues are not set up here"
	ffpcNotInListWords = "That league is not in your FFPC list. " + ffpcPickWords
)

// attachFFPC attaches one of the member's FFPC leagues, read as them: the
// league id from their list opens their own team (My Teams' own link,
// never a pasted team address), the league is read once as them, and the
// link keeps their league-team id so later reads use it.
func (s *Service) attachFFPC(w http.ResponseWriter, r *http.Request, in apitypes.AttachInput) {
	if s.FFPC == nil {
		httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeUnavailable, ffpcNotConfigured, nil)
		return
	}
	ref, err := s.FFPC.Parse(in.Link)
	if err != nil {
		httpx.WriteInvalid(w, r, map[string]string{fieldLink: ffpcPickWords})
		return
	}
	ctx := r.Context()
	accountID := auth.AccountID(r)
	ltuid, err := s.FFPC.Member.OpenLeague(ctx, accountID, ref.LeagueID)
	if err != nil {
		err = ffpcErr(err)
		if errors.Is(err, ErrNotFound) {
			httpx.WriteInvalid(w, r, map[string]string{fieldLink: ffpcNotInListWords})
			return
		}
		s.writeHostError(w, r, HostFFPC, err)
		return
	}
	snap, teamID, err := s.FFPC.ReadAs(ctx, accountID, ltuid)
	if err != nil {
		s.writeHostError(w, r, HostFFPC, err)
		return
	}
	if snap.Ref.LeagueID != ref.LeagueID || teamID < 1 {
		httpx.WriteInvalid(w, r, map[string]string{fieldLink: ffpcNotInListWords})
		return
	}
	link, err := s.save(ctx, accountID, snap, teamID, ltuid)
	if errors.Is(err, ErrTooMany) {
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, tooManyWords(), nil)
		return
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "leaguesync: attach ffpc", err)
		return
	}
	s.Poller.Keep(snap)
	s.Poller.Prime(snap)
	s.answer(w, r, http.StatusCreated, link, Read{Snapshot: snap})
}

// writeFFPCError answers the FFPC-only errors, and reports whether it did.
func writeFFPCError(w http.ResponseWriter, r *http.Request, err error) bool {
	switch {
	case errors.Is(err, ErrNotConnected):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, ffpcConnectWords, nil)
	case errors.Is(err, ErrSignInAgain):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, ffpcSignInWords, nil)
	default:
		return false
	}
	return true
}

// tooManyWords is the attach cap's sentence.
func tooManyWords() string {
	return fmt.Sprintf("You have attached %d leagues, the most allowed. Detach one first", MaxLinksPerAccount)
}
