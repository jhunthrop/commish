package leaguesync

import (
	"context"
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
	f, err := s.follow(r.Context(), link)
	var host hostError
	switch {
	case errors.As(err, &host):
		s.writeHostError(w, r, link.Ref.Host, host.err)
		return Followed{}, false
	case err != nil:
		httpx.WriteInternal(w, r, s.Log, "leaguesync: follow", err)
		return Followed{}, false
	}
	return f, true
}

// FollowedAt is every live link's league for a read that just landed,
// each followed as its route would follow it (the shared read, the saved
// league, the board), for work a landed read starts (Lane 66u: the trade
// search). A link whose follow fails is logged and left out.
func (s *Service) FollowedAt(ctx context.Context, ref Ref) ([]Followed, error) {
	links, err := s.Links.LinksOf(ctx, ref)
	if err != nil {
		return nil, err
	}
	out := make([]Followed, 0, len(links))
	for _, link := range links {
		f, err := s.follow(ctx, link)
		if err != nil {
			s.Log.Warn("leaguesync: follow a landed read", "league", ref.Key(), "err", err)
			continue
		}
		out = append(out, f)
	}
	return out, nil
}

// hostError is a follow the host stopped (its read, or a placement the
// host's directory could not make), answered in the host's words.
type hostError struct{ err error }

func (e hostError) Error() string { return e.err.Error() }
func (e hostError) Unwrap() error { return e.err }

// follow is Follow for a link already loaded: the shared read, the saved
// league and the board. A hostError is the host's; any other is ours.
func (s *Service) follow(ctx context.Context, link Link) (Followed, error) {
	read, err := s.Poller.Read(ctx, link.Ref)
	if err != nil {
		return Followed{}, hostError{err}
	}
	pr, err := s.prepare(ctx, link, read)
	if errors.Is(err, ErrUnavailable) {
		return Followed{}, hostError{err}
	}
	if err != nil {
		return Followed{}, err
	}
	held, _ := heldOnBoard(pr.snap, pr.placed)
	return Followed{Link: link, Snap: pr.snap, Stale: read.Stale, Saved: pr.saved, Board: pr.board, HeldBy: held, players: pr.players}, nil
}
