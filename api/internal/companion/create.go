package companion

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// Field problems, in the drafter's words.
const (
	fieldDraft  = "draft"
	fieldSeat   = "seat"
	fieldReplay = "replay"
	fieldHost   = "host"

	draftLinkWords = "Paste the link to a Sleeper draft, like sleeper.com/draft/nfl/1234567890"
	seatWords      = "Pick your draft slot, or give your Sleeper username"
)

// errUserNotInOrder is a username the draft's order does not hold yet.
var errUserNotInOrder = errors.New("companion: user not in the draft order")

func (s *Service) create(w http.ResponseWriter, r *http.Request) {
	if !s.allowed(w, r) {
		return
	}
	var in apitypes.CompanionCreate
	if !httpx.DecodeJSON(w, r, httpx.MaxSmallBody, &in) {
		return
	}
	replay := in.Replay != nil && *in.Replay
	draftID, errs := s.checkCreate(in, replay)
	if errs != nil {
		httpx.WriteInvalid(w, r, errs)
		return
	}
	ctx := r.Context()
	d, league, err := s.hostDraft(ctx, draftID, replay)
	if err != nil {
		s.writeHostError(w, r, err)
		return
	}
	seat, err := s.seatOf(ctx, d, in.Seat)
	if errors.Is(err, errUserNotInOrder) {
		httpx.WriteInvalid(w, r, map[string]string{fieldSeat: "That username is not in this draft's order yet. Pick your slot instead"})
		return
	}
	if err != nil {
		s.writeHostError(w, r, err)
		return
	}
	if seat < 1 || seat > d.Teams {
		httpx.WriteInvalid(w, r, map[string]string{fieldSeat: fmt.Sprintf("Pick a slot from 1 to %d", d.Teams)})
		return
	}
	settings, err := SettingsFor(d, league, seat)
	if err != nil {
		s.writeHostError(w, r, err)
		return
	}
	row, err := s.Store.Upsert(ctx, Row{
		AccountID: auth.AccountID(r), Host: string(apitypes.CompanionHostSleeper), HostDraftID: draftID, HostLeagueID: d.LeagueID,
		Replay: replay, Seat: seat, HostUsername: usernameOf(in.Seat), Settings: settings, Status: d.Status,
	})
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "companion: create", err)
		return
	}
	s.answer(w, r, row, 0)
}

// checkCreate validates the request: the host, the link, the seat's
// shape, and a replay only where replays are on.
func (s *Service) checkCreate(in apitypes.CompanionCreate, replay bool) (string, map[string]string) {
	errs := map[string]string{}
	if in.Host != apitypes.CompanionHostSleeper {
		errs[fieldHost] = "The companion follows Sleeper drafts today"
	}
	draftID, err := sleeper.ParseDraftLink(in.Draft)
	switch {
	case replay:
		// A replay always follows the recorded draft, whatever was pasted.
		draftID = ReplayDraftID
	case err != nil:
		errs[fieldDraft] = draftLinkWords
	}
	hasSlot := in.Seat.Slot != nil
	hasUser := in.Seat.Username != nil && strings.TrimSpace(*in.Seat.Username) != ""
	if hasSlot == hasUser {
		errs[fieldSeat] = seatWords
	}
	if replay && s.Replay == nil {
		errs[fieldReplay] = "A replay is for development only"
	}
	if len(errs) > 0 {
		return "", errs
	}
	return draftID, nil
}

// hostDraft is the draft and its league, from the host or the recording.
func (s *Service) hostDraft(ctx context.Context, draftID string, replay bool) (sleeper.Draft, *sleeper.League, error) {
	if replay {
		d := s.Replay.At(0, 0).Draft
		league := s.Replay.League
		return d, &league, nil
	}
	read, err := s.Poller.Read(ctx, draftID)
	if err != nil {
		return sleeper.Draft{}, nil, err
	}
	d := read.Draft
	if d.LeagueID == "" {
		return d, nil, nil
	}
	league, err := s.Directory.League(ctx, d.LeagueID)
	if err != nil {
		return sleeper.Draft{}, nil, err
	}
	return d, &league, nil
}

// seatOf is the drafter's slot: the one they chose, or the one the
// draft's order gives their username.
func (s *Service) seatOf(ctx context.Context, d sleeper.Draft, seat apitypes.CompanionSeat) (int, error) {
	if seat.Slot != nil {
		return *seat.Slot, nil
	}
	userID, err := s.Directory.UserID(ctx, strings.TrimSpace(*seat.Username))
	if errors.Is(err, sleeper.ErrNotFound) {
		return 0, errUserNotInOrder
	}
	if err != nil {
		return 0, err
	}
	slot, ok := d.Order[userID]
	if !ok {
		return 0, errUserNotInOrder
	}
	return slot, nil
}

// usernameOf is the username a seat was found by, empty for a slot.
func usernameOf(seat apitypes.CompanionSeat) string {
	if seat.Slot != nil || seat.Username == nil {
		return ""
	}
	return strings.TrimSpace(*seat.Username)
}
