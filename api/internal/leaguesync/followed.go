package leaguesync

import (
	"errors"
	"net/http"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// Followed is one attached league as the in-season tools read it (spec
// 2026-10-15 §7): the drafter's link and seat, the league as the sync
// route reads it, the saved league whose scoring and roster the advice
// follows, and our board valued for the league.
type Followed struct {
	Link Link
	// Snap is the league as the drafter may see it (on FFPC, no other
	// team's lineup).
	Snap Snapshot
	// Stale is how old the read is when the host failed.
	Stale time.Duration
	// Saved is the saved league the attach made, nil when the league's
	// scoring could not be saved (SettingsNote says why).
	Saved *apitypes.LeagueSettings
	Board boards.Board
	// HeldBy is the roster holding each placed player, by board id.
	HeldBy  map[string]int
	players players
}

// Player is a host player as the wire names him, with his board id when
// we placed him.
func (f Followed) Player(hostID string) apitypes.LeaguePlayer { return f.players.player(hostID) }

// SettingsNote is why the league has no saved scoring, in the words the
// league page uses.
func (f Followed) SettingsNote() string { return *settingsNote(f.Snap) }

// NoGamesWords is the league page's line for a league with no current
// week.
const NoGamesWords = "Your league has no games this week."

// Follow is the account's league for an in-season route: the link, the
// read the sync route shares (one upstream read per league a minute),
// the saved league and the board. When it cannot, it answers as the
// sync route does and reports false.
func (s *Service) Follow(w http.ResponseWriter, r *http.Request) (Followed, bool) {
	link, ok := s.load(w, r)
	if !ok {
		return Followed{}, false
	}
	read, err := s.Poller.Read(r.Context(), link.Ref)
	if err != nil {
		s.writeHostError(w, r, link.Ref.Host, err)
		return Followed{}, false
	}
	pr, err := s.prepare(r.Context(), link, read)
	if errors.Is(err, ErrUnavailable) {
		s.writeHostError(w, r, link.Ref.Host, err)
		return Followed{}, false
	}
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "leaguesync: follow", err)
		return Followed{}, false
	}
	held, _ := heldOnBoard(pr.snap, pr.placed)
	return Followed{Link: link, Snap: pr.snap, Stale: read.Stale, Saved: pr.saved, Board: pr.board, HeldBy: held, players: pr.players}, true
}
