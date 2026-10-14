package leaguesync

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/leagues"
)

var usernamePattern = regexp.MustCompile(`^[A-Za-z0-9_]{1,40}$`)

// checkSeat validates the seat's shape: exactly one of a username and a
// roster id.
func checkSeat(me apitypes.AttachSeat) map[string]string {
	hasUser := me.Username != nil && strings.TrimSpace(*me.Username) != ""
	hasRoster := me.RosterId != nil
	switch {
	case hasUser == hasRoster:
		return map[string]string{fieldMe: seatWords}
	case hasUser && !usernamePattern.MatchString(strings.TrimSpace(*me.Username)):
		return map[string]string{fieldMe: "A Sleeper username is letters, digits and underscores"}
	}
	return nil
}

func (s *Service) attach(w http.ResponseWriter, r *http.Request) {
	var in apitypes.AttachInput
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	if in.Host != nil && *in.Host == apitypes.LeagueHostFfpc {
		s.attachFFPC(w, r, in)
		return
	}
	if in.Host != nil && *in.Host == apitypes.LeagueHostYahoo {
		s.attachMember(w, r, in, HostYahoo)
		return
	}
	if in.Host != nil && *in.Host == apitypes.LeagueHostEspn && in.Me.RosterId == nil && in.Me.Username == nil {
		// An ESPN league from the member's own list: read with their
		// cookies, seated at the team their ESPN account owns.
		s.attachMember(w, r, in, HostESPN)
		return
	}
	if errs := checkSeat(in.Me); errs != nil {
		httpx.WriteInvalid(w, r, errs)
		return
	}
	h, ref, ok := s.resolve(w, r, in.Host, in.Link)
	if !ok {
		return
	}
	many, ok := s.admitLeague(w, r, ref)
	if !ok {
		return
	}
	ctx := r.Context()
	read, err := s.readFor(ctx, auth.AccountID(r), ref)
	if err != nil {
		s.writeHostError(w, r, ref.Host, err)
		return
	}
	roster, err := s.seat(ctx, h, read.Snapshot, in.Me)
	if err != nil {
		s.writeSeatError(w, r, ref.Host, err)
		return
	}
	accountID := auth.AccountID(r)
	link, err := s.save(ctx, accountID, read.Snapshot, roster, "", many)
	if writeCapError(w, r, err) {
		return
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "leaguesync: attach", err)
		return
	}
	// The league is linked now, so its read is kept from here on.
	s.Poller.Keep(read.Snapshot)
	s.answer(w, r, http.StatusCreated, link, read)
}

// seat is the drafter's roster: the one they picked, or the one their
// username runs.
func (s *Service) seat(ctx context.Context, h Host, snap Snapshot, me apitypes.AttachSeat) (int, error) {
	if me.RosterId != nil {
		if _, ok := snap.TeamByRoster(*me.RosterId); !ok {
			return 0, ErrNoSeat
		}
		return *me.RosterId, nil
	}
	return h.SeatByUsername(ctx, snap, strings.TrimSpace(*me.Username))
}

func (s *Service) writeSeatError(w http.ResponseWriter, r *http.Request, host string, err error) {
	switch {
	case errors.Is(err, ErrNoSeat):
		httpx.WriteInvalid(w, r, map[string]string{fieldMe: "That team is not in this league. " + pickTeamWords})
	case errors.Is(err, ErrSeatByName):
		httpx.WriteInvalid(w, r, map[string]string{fieldMe: pickTeamWords})
	default:
		s.writeHostError(w, r, host, err)
	}
}

// save writes the saved league a mock reruns from (when a mock room can
// draft the league) and the link. A saved league made here is deleted
// again if the link cannot be written.
func (s *Service) save(ctx context.Context, accountID uuid.UUID, snap Snapshot, roster int, teamKey string, many bool) (Link, error) {
	prev, found, err := s.Links.Find(ctx, accountID, snap.Ref)
	if err != nil {
		return Link{}, err
	}
	var prevLeague *uuid.UUID
	if found {
		prevLeague = prev.LeagueID
	}
	leagueID, made, err := s.saveSettings(ctx, accountID, snap, prevLeague)
	if err != nil {
		return Link{}, err
	}
	at := snap.ReadAt
	link, err := s.Links.Save(ctx, Link{AccountID: accountID, LeagueID: leagueID, Ref: snap.Ref, RosterID: roster, LastReadAt: &at, TeamKey: teamKey}, many)
	if err != nil && made && leagueID != nil {
		if derr := s.Saved.Delete(ctx, accountID, *leagueID); derr != nil {
			s.Log.Warn("leaguesync: undo saved league", "league", *leagueID, "err", derr)
		}
	}
	return link, err
}

// saveSettings writes the league's settings over the saved league the
// link made before, or as a new one; nil when a mock room cannot draft
// the league or the account has saved the most leagues allowed. made
// says a new saved league was written.
func (s *Service) saveSettings(ctx context.Context, accountID uuid.UUID, snap Snapshot, prev *uuid.UUID) (*uuid.UUID, bool, error) {
	settings, reason := SettingsFor(snap)
	if reason != "" {
		return nil, false, nil
	}
	in := apitypes.LeagueInput{Name: savedName(snap), Settings: settings}
	if prev != nil {
		l, err := s.Saved.Replace(ctx, accountID, *prev, in)
		if err == nil {
			return &l.Id, false, nil
		}
		if !errors.Is(err, leagues.ErrNotFound) {
			return nil, false, err
		}
	}
	l, err := s.Saved.Create(ctx, accountID, in)
	if errors.Is(err, leagues.ErrTooMany) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return &l.Id, true, nil
}

// savedName is the league's name as the setup page lists it.
func savedName(snap Snapshot) string {
	name := strings.TrimSpace(snap.Name)
	if name == "" {
		name = "My " + hostWords(snap.Ref.Host) + " league"
	}
	if utf8.RuneCountInString(name) > maxSavedLeagueNameLen {
		name = string([]rune(name)[:maxSavedLeagueNameLen])
	}
	return name
}
