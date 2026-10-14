package hosts

import (
	"context"
	"log/slog"
	"net/http"

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
	Store   Lister
	Log     *slog.Logger
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
	list, err := l.Store.List(r.Context(), account.ID)
	if err != nil {
		httpx.WriteInternal(w, r, l.Log, "hosts: list", err)
		return
	}
	for _, c := range list {
		out.Connections = append(out.Connections, View(c))
	}
	httpx.WriteOK(w, r, http.StatusOK, out)
}

// View is a connection on the wire: its host, its state and when it was
// made and last read, never a credential.
func View(c Connection) apitypes.HostConnection {
	return apitypes.HostConnection{
		Host: apitypes.ConnectedHost(c.Host), Status: apitypes.HostConnectionStatus(c.Status),
		ConnectedAt: c.CreatedAt, LastReadAt: c.LastReadAt,
	}
}
