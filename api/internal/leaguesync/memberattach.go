package leaguesync

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// MemberHost is a host read as a connected member (Yahoo): a league is
// attached from the member's own list, read once as them, and they are
// seated at their own team.
type MemberHost interface {
	Host
	ReadAs(ctx context.Context, accountID uuid.UUID, ref Ref) (Snapshot, int, error)
}

// pickedFromList reports a host whose leagues are attached only from the
// member's own list, never previewed from a link.
func pickedFromList(host string) bool { return host == HostFFPC || host == HostYahoo }

// switchable reports a host with its own switch, so a league on it with
// the host switched off says so.
func switchable(host string) bool { return pickedFromList(host) || host == HostESPN }

// memberWords is a member host's sentences, in its own name: Yahoo is
// connected, FFPC is signed in to.
type memberWords struct {
	off, pick, notInList, attachFirst, noReader, again string
}

func wordsFor(host string) memberWords {
	name := hostWords(host)
	w := memberWords{
		off:         name + " leagues are not open here right now.",
		pick:        "Pick your league from your " + name + " list.",
		notInList:   "That league is not in your " + name + " list. Pick your league from your " + name + " list.",
		attachFirst: "Connect " + name + " first.",
		noReader:    "No one in this league is connected to " + name + " on Commish right now. Connect " + name + " to read it.",
		again:       name + " asks you to connect again. Connect " + name + " to keep reading your league.",
	}
	if host == HostFFPC {
		w.attachFirst = "Connect FFPC first. Sign in to FFPC above."
		w.noReader = "No one in this league is signed in to FFPC on Commish right now. Sign in to read it."
		w.again = "FFPC signed you out. Sign in to FFPC again to keep reading your league."
	}
	return w
}

// writeMemberError answers the errors of a host read as a member, and
// reports whether it did.
func writeMemberError(w http.ResponseWriter, r *http.Request, host string, err error) bool {
	words := wordsFor(host)
	switch {
	case errors.Is(err, ErrHostOff):
		httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeUnavailable, words.off, nil)
	case errors.Is(err, ErrNotConnected):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, words.noReader, nil)
	case errors.Is(err, ErrSignInAgain):
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, words.again, nil)
	default:
		return false
	}
	return true
}

// writeMemberAttachError answers an attach that could not read as the
// member: the attacher is the one to connect, so the words are theirs.
func (s *Service) writeMemberAttachError(w http.ResponseWriter, r *http.Request, host string, err error) {
	if errors.Is(err, ErrNotConnected) {
		httpx.WriteError(w, r, http.StatusConflict, httpx.CodeConflict, wordsFor(host).attachFirst, nil)
		return
	}
	s.writeHostError(w, r, host, err)
}

// memberHost is the member host with the key, when it is switched on.
func (s *Service) memberHost(key string) (MemberHost, bool) {
	h, ok := s.Hosts.ByKey(key)
	if !ok {
		return nil, false
	}
	m, ok := h.(MemberHost)
	return m, ok
}

// attachMember attaches one of the member's leagues on a member host,
// read as them: the league id from their list, read once, their own team
// as the seat.
func (s *Service) attachMember(w http.ResponseWriter, r *http.Request, in apitypes.AttachInput, key string) {
	words := wordsFor(key)
	h, ok := s.memberHost(key)
	if !ok {
		httpx.WriteError(w, r, http.StatusServiceUnavailable, httpx.CodeUnavailable, words.off, nil)
		return
	}
	ref, err := h.Parse(in.Link)
	if err != nil {
		httpx.WriteInvalid(w, r, map[string]string{fieldLink: words.pick})
		return
	}
	many, ok := s.admitLeague(w, r, ref)
	if !ok {
		return
	}
	ctx, accountID := r.Context(), auth.AccountID(r)
	snap, team, err := h.ReadAs(ctx, accountID, ref)
	if errors.Is(err, ErrNotFound) || errors.Is(err, ErrPrivate) {
		httpx.WriteInvalid(w, r, map[string]string{fieldLink: words.notInList})
		return
	}
	if err != nil {
		s.writeMemberAttachError(w, r, key, err)
		return
	}
	if snap.Ref.LeagueID != ref.LeagueID || team < 1 {
		httpx.WriteInvalid(w, r, map[string]string{fieldLink: words.notInList})
		return
	}
	// Read with this account's own credential, the league is kept and
	// answered for this account alone.
	snap.Ref.As = accountID
	link, err := s.save(ctx, accountID, snap, team, "", many)
	if writeCapError(w, r, err) {
		return
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "leaguesync: attach "+key, err)
		return
	}
	s.Poller.Keep(snap)
	s.Poller.Prime(snap)
	s.answer(w, r, http.StatusCreated, link, Read{Snapshot: snap})
}
