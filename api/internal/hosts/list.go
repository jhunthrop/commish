package hosts

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// limitListPerMin bounds GET /hosts: the account page and the attach page
// read it once each on load.
const limitListPerMin = 120

// Lister is the part of Store GET /hosts reads.
type Lister interface {
	List(ctx context.Context, accountID uuid.UUID) ([]Connection, error)
}

// List serves GET /hosts: which hosts connecting is open for here (each
// host's switch with the vault's key present) and the account's own
// connections. No credential is ever answered.
type List struct {
	// Enabled is the hosts open here, in the order the account page lists
	// them.
	Enabled []apitypes.ConnectedHost
	// Accounts is the hosts open to one signed-in account alone (a host
	// whose switch is off, open to its proof list), nil for none.
	Accounts OpenTo
	// Writes says whether each connection's lineup is set from our screen,
	// nil when nothing does: every connection then reads writes off.
	Writes Writes
	Store  Lister
	Log    *slog.Logger
}

// Writes says whether the member's lineup is set on a platform from our
// screen, and why not. *hostmoves.Service implements it.
type Writes interface {
	LineupMove(ctx context.Context, accountID uuid.UUID, host string) (apitypes.LineupMoves, error)
}

// uncheckedWords is a connection's writes line when the check failed: the
// row stays, writes read off, and the reason says so.
const uncheckedWords = "We could not check lineup moves just now, so they read off."

// OpenTo is the hosts open to an account beyond the ones open to all.
type OpenTo interface {
	OpenTo(ctx context.Context, accountID uuid.UUID) ([]apitypes.ConnectedHost, error)
}

// Routes is GET /hosts.
func (l *List) Routes() []httpx.Route {
	return []httpx.Route{
		{Method: http.MethodGet, Path: "/hosts", Access: httpx.Public, Limit: httpx.PerMinute(limitListPerMin), Handler: l.list},
	}
}

// list answers the switches to anyone, since a switch is not account
// data, and the account's own connections when signed in.
func (l *List) list(w http.ResponseWriter, r *http.Request) {
	out := apitypes.HostConnections{Enabled: append([]apitypes.ConnectedHost{}, l.Enabled...), Connections: []apitypes.HostConnection{}}
	account, signedIn := auth.AccountFrom(r.Context())
	if !signedIn {
		httpx.WriteOK(w, r, http.StatusOK, out)
		return
	}
	if l.Accounts != nil {
		// A failed check leaves those hosts out: the rest still answer.
		more, err := l.Accounts.OpenTo(r.Context(), account.ID)
		if err != nil {
			l.Log.Warn("hosts: open to", "account", account.ID, "err", err)
		}
		out.Enabled = append(out.Enabled, more...)
	}
	list, err := l.Store.List(r.Context(), account.ID)
	if err != nil {
		httpx.WriteInternal(w, r, l.Log, "hosts: list", err)
		return
	}
	for _, c := range list {
		out.Connections = append(out.Connections, l.withWrites(r.Context(), account.ID, c))
	}
	httpx.WriteOK(w, r, http.StatusOK, out)
}

// withWrites is a connection with whether its lineup is set from our
// screen, and when not, the Account room's sentence why. A failed check
// keeps the row, writes off, with a reason.
func (l *List) withWrites(ctx context.Context, accountID uuid.UUID, c Connection) apitypes.HostConnection {
	v := View(c)
	if l.Writes == nil {
		return v
	}
	moves, err := l.Writes.LineupMove(ctx, accountID, c.Host)
	if err != nil {
		l.Log.Warn("hosts: writes", "host", c.Host, "err", err)
		reason := uncheckedWords
		v.WritesReason = &reason
		return v
	}
	v.WritesOn = moves.Lineup == apitypes.LineupMovesLineupAvailable
	if !v.WritesOn {
		reason := writesOffWords(c, moves)
		v.WritesReason = &reason
	}
	return v
}

// platformNames are the platforms as the Account room names them.
var platformNames = map[string]string{"ffpc": "FFPC", "yahoo": "Yahoo", "espn": "ESPN", "mfl": "MyFantasyLeague"}

// writesOffWords is the Account room's own sentence for why a platform's
// lineup is not set from here (Lane 66k L1): it names the platform and
// what the member does on this page, never the Lineup screen's copy verb.
func writesOffWords(c Connection, moves apitypes.LineupMoves) string {
	name := platformNames[c.Host]
	switch {
	case !moves.TakesWrites:
		return name + " takes no lineups from here."
	case !moves.WritesOn:
		return "Lineups on " + name + " are not open to your account yet."
	case c.Status != StatusConnected:
		return "Connect " + name + " again to set your lineup from here."
	case c.ConsentVersion < consentVersions[c.Host]:
		return "Connect " + name + " again and agree to moves to set your lineup from here."
	}
	return uncheckedWords
}

// FollowKey is a followed league's key in a host's league list: its id
// and season, as leaguesync.Store.FollowedIDs answers them.
func FollowKey(leagueID string, season int) string {
	return leagueID + "/" + strconv.Itoa(season)
}

// Deleter is the part of Store a disconnect uses.
type Deleter interface {
	Delete(ctx context.Context, accountID uuid.UUID, host string) error
}

// Disconnect is DELETE /hosts/{host}: the account's connection to the
// host and everything kept with it deleted at once.
func Disconnect(store Deleter, host string, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := store.Delete(r.Context(), auth.AccountID(r), host)
		if errors.Is(err, ErrNotConnected) {
			httpx.WriteNotFound(w, r)
			return
		}
		if err != nil {
			httpx.WriteInternal(w, r, log, host+": disconnect", err)
			return
		}
		httpx.WriteOK(w, r, http.StatusOK, nil)
	}
}

// LeagueLine is one of a member's leagues as a host's list names it.
type LeagueLine struct {
	LeagueID string
	Season   int
	Name     string
	TeamName string
	// Teams is the league's size, 0 when the list does not say.
	Teams int
	// Scoring is the scoring type in our words, empty when unsaid.
	Scoring string
	// Public is whether the public reads the league, nil when not checked.
	Public *bool
	// Unmarked is why a league the host could mark public carries no
	// mark (apitypes.HostLeagueUnmarked), empty when it has one or the
	// host marks none.
	Unmarked string
}

// LeagueView is a list line on the wire, marked followed when followed
// (keyed by FollowKey) holds it.
func LeagueView(l LeagueLine, followed map[string]bool) apitypes.HostLeague {
	v := apitypes.HostLeague{LeagueId: l.LeagueID, Name: l.Name, TeamName: l.TeamName, Public: l.Public}
	if l.Unmarked != "" {
		why := apitypes.HostLeagueUnmarked(l.Unmarked)
		v.Unmarked = &why
	}
	attached := followed[FollowKey(l.LeagueID, l.Season)]
	v.Attached = &attached
	if l.Teams > 0 {
		teams := l.Teams
		v.Teams = &teams
	}
	if l.Scoring != "" {
		scoring := l.Scoring
		v.ScoringType = &scoring
	}
	return v
}

// View is a connection on the wire: its host, its state, whether it is
// proven and when it was made and last read, never a credential.
func View(c Connection) apitypes.HostConnection {
	return apitypes.HostConnection{
		Host: apitypes.ConnectedHost(c.Host), Status: apitypes.HostConnectionStatus(c.Status),
		ConnectedAt: c.CreatedAt, LastReadAt: c.LastReadAt, Proven: c.Proven, ConsentVersion: c.ConsentVersion,
	}
}
