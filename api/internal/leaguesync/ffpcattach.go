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
	ffpcPickWords      = "Pick your league from your FFPC list."
	ffpcNotConfigured  = "FFPC leagues are not open here right now."
	ffpcNotInListWords = "That league is not in your FFPC list. " + ffpcPickWords
)

// attachFFPC attaches one of the member's FFPC leagues, read as them: the
// league id from their list opens their own team (My Teams' own link,
// never a pasted team address), the league is read once as them, and the
// link keeps their league-team id so every later read is theirs alone.
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
	many, ok := s.admitLeague(w, r, Ref{Host: HostFFPC, LeagueID: ref.LeagueID})
	if !ok {
		return
	}
	ctx := r.Context()
	accountID := auth.AccountID(r)
	ltuid, err := s.FFPC.Member.OpenLeague(ctx, accountID, ref.LeagueID)
	if err != nil {
		err = ffpcErr(err)
		if errors.Is(err, ErrNotFound) { // ffpc.ErrNoSuchLeague
			httpx.WriteInvalid(w, r, map[string]string{fieldLink: ffpcNotInListWords})
			return
		}
		s.writeAttachError(w, r, err)
		return
	}
	snap, teamID, err := s.FFPC.ReadAs(ctx, accountID, ltuid)
	if err != nil {
		s.writeAttachError(w, r, err)
		return
	}
	if snap.Ref.LeagueID != ref.LeagueID || teamID < 1 {
		httpx.WriteInvalid(w, r, map[string]string{fieldLink: ffpcNotInListWords})
		return
	}
	// Read with this account's own sign-in, the league is kept and
	// answered for this account alone.
	snap.Ref.As = accountID
	link, err := s.save(ctx, accountID, snap, teamID, ltuid, many)
	if writeCapError(w, r, err) {
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

// tooManyWords is the attach cap's sentence.
func tooManyWords() string {
	return fmt.Sprintf("You have attached %d leagues, the most allowed. Detach one first", MaxLinksPerAccount)
}

// writeAttachError answers an attach that could not read as the member:
// the attacher is the one to sign in, so the words are theirs.
func (s *Service) writeAttachError(w http.ResponseWriter, r *http.Request, err error) {
	s.writeMemberAttachError(w, r, HostFFPC, err)
}
