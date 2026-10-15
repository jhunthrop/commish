package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/draftroom"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/espn"
	"github.com/jhunthrop/commish/api/internal/hostmoves"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/espnhost"
	"github.com/jhunthrop/commish/api/internal/hosts/ffpc"
	"github.com/jhunthrop/commish/api/internal/hosts/yahoo"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/leagues"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
	"github.com/jhunthrop/commish/api/internal/mfl"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// ffpcWiring is FFPC read as connected members: the vault that opens
// their kept session, the one client every read goes through (paced with
// every other process by the database gate), and the member reader. On
// is HOST_FFPC_ENABLED with the vault's key present.
type ffpcWiring struct {
	on     bool
	vault  *hosts.Vault
	store  *hosts.Store
	client *ffpc.Client
	member *ffpc.Member
}

func newFFPCWiring(cfg config.API, pool *pgxpool.Pool, log *slog.Logger) (ffpcWiring, error) {
	current, ring := cfg.Hosts.Ring()
	vault, err := hosts.NewVault(hosts.Keys{Current: current, ByVer: ring})
	if err != nil {
		return ffpcWiring{}, err
	}
	on := cfg.Hosts.FFPCEnabled && vault.Ready()
	if !on {
		log.Warn("ffpc is off", "enabled", cfg.Hosts.FFPCEnabled, "key", vault.Ready())
	}
	store := &hosts.Store{Pool: pool}
	client := ffpc.New()
	if cfg.Dev.FFPCBaseURL != "" {
		client = ffpc.NewAt(cfg.Dev.FFPCBaseURL)
		log.Warn("ffpc is the local stand-in", "base", cfg.Dev.FFPCBaseURL)
	}
	client.Pace = &hosts.Gate{Pool: pool, Host: ffpc.Host, Gap: ffpc.Gap, MaxWait: ffpc.MaxQueue}
	member := &ffpc.Member{Client: client, Store: store, Vault: vault, Now: time.Now, Log: log}
	return ffpcWiring{on: on, vault: vault, store: store, client: client, member: member}, nil
}

// routes are connecting, listing and disconnecting FFPC; off, the list
// says so and connecting answers 503.
func (f ffpcWiring) routes(log *slog.Logger) []httpx.Route {
	return (&ffpc.Service{Enabled: f.on, Signer: f.client, Store: f.store, Vault: f.vault, Leagues: f.member, Now: time.Now, Log: log}).Routes()
}

// host is the FFPC league host over the link store, nil when FFPC is off.
// weeks is the run's schedule, the source of the league's current week.
func (f ffpcWiring) host(store *leaguesync.Store, weeks leaguesync.WeekSource, log *slog.Logger) *leaguesync.FFPC {
	if !f.on {
		return nil
	}
	return &leaguesync.FFPC{Member: f.member, Readers: store, Weeks: weeks, Now: time.Now, Log: log}
}

// yahooWiring is Yahoo read as connected members: the app's OAuth
// registration, the one client every read goes through (paced with every
// other process by the database gate) and the member reader, over the
// vault FFPC's wiring opened. On is HOST_YAHOO_ENABLED with the vault's
// key and the app's id and secret present.
type yahooWiring struct {
	on     bool
	oauth  *yahoo.OAuth
	member *yahoo.Member
}

func newYahooWiring(cfg config.API, pool *pgxpool.Pool, ff ffpcWiring, log *slog.Logger) yahooWiring {
	on := cfg.Hosts.YahooEnabled && ff.vault.Ready() && cfg.Hosts.YahooConfigured()
	if !on {
		log.Warn("yahoo is off", "enabled", cfg.Hosts.YahooEnabled, "key", ff.vault.Ready(), "app", cfg.Hosts.YahooConfigured())
	}
	oauth := yahoo.NewOAuth(cfg.Hosts.YahooClientID, cfg.Hosts.YahooClientSecret, cfg.HTTP.APIBaseURL+"/hosts/yahoo/callback")
	client := yahoo.New()
	client.Pace = &hosts.Gate{Pool: pool, Host: yahoo.Host, Gap: yahoo.Gap, MaxWait: yahoo.MaxQueue}
	member := &yahoo.Member{Client: client, OAuth: oauth, Store: ff.store, Vault: ff.vault, Now: time.Now, Log: log}
	return yahooWiring{on: on, oauth: oauth, member: member}
}

// routes are connecting, listing and disconnecting Yahoo.
func (y yahooWiring) routes(cfg config.API, pool *pgxpool.Pool, ff ffpcWiring, log *slog.Logger) []httpx.Route {
	return (&yahoo.Service{
		Enabled: y.on, OAuth: y.oauth, States: &yahoo.States{Pool: pool}, Store: ff.store, Vault: ff.vault,
		Leagues: y.member, Followed: &leaguesync.Store{Pool: pool}, PublicBaseURL: cfg.HTTP.PublicBaseURL, Now: time.Now, Log: log,
	}).Routes()
}

// host is the Yahoo league host, nil when Yahoo is off.
func (y yahooWiring) host(ids leaguesync.HostIDs, log *slog.Logger) *leaguesync.Yahoo {
	if !y.on {
		return nil
	}
	return &leaguesync.Yahoo{Member: y.member, IDs: ids, Now: time.Now, Log: log}
}

// espnWiring is ESPN: public leagues read as the public reads them, and a
// connected member's private leagues read with their kept cookies. The
// host is HOST_ESPN_ENABLED; connecting needs the vault's key as well.
type espnWiring struct {
	host      bool
	connect   bool
	client    *espn.Client
	publicity *espnhost.Publicity
	member    *espnhost.Member
}

func newESPNWiring(cfg config.API, pool *pgxpool.Pool, ff ffpcWiring, log *slog.Logger) espnWiring {
	connect := cfg.Hosts.ESPNEnabled && ff.vault.Ready()
	if !connect {
		log.Warn("espn connecting is off", "enabled", cfg.Hosts.ESPNEnabled, "key", ff.vault.Ready())
	}
	client := espn.New()
	client.Pace = &hosts.Gate{Pool: pool, Host: espnhost.Host, Gap: espn.Gap, MaxWait: espn.MaxQueue}
	// One process-wide answer to "does the public read this league", kept
	// for the hour, shared by the connect, the list and the member reads.
	publicity := &espnhost.Publicity{Client: client, Now: time.Now}
	member := &espnhost.Member{Client: client, Public: publicity, Store: ff.store, Vault: ff.vault, Now: time.Now, Log: log}
	return espnWiring{host: cfg.Hosts.ESPNEnabled, connect: connect, client: client, publicity: publicity, member: member}
}

// routes are connecting, listing and disconnecting ESPN.
func (e espnWiring) routes(pool *pgxpool.Pool, ff ffpcWiring, log *slog.Logger) []httpx.Route {
	return (&espnhost.Service{
		Enabled: e.connect, Client: e.client, Public: e.publicity, Store: ff.store, Vault: ff.vault, Leagues: e.member,
		Followed: &leaguesync.Store{Pool: pool}, Now: time.Now, Log: log,
	}).Routes()
}

// hostMoves is a move on a host the member confirms on our screen: an
// ESPN lineup set or claim, open while ESPN is (HOST_ESPN_ENABLED with the
// vault's key), each to every member when its switch is on
// (HOST_WRITES_ESPN_LINEUP, HOST_WRITES_ESPN_CLAIM) and to the allow
// list's accounts for that kind alone when it is off. Its confirm tokens are
// signed under a key derived from the session secret.
func hostMoves(cfg config.API, pool *pgxpool.Pool, ff ffpcWiring, e espnWiring, log *slog.Logger) (*hostmoves.Service, error) {
	key, err := auth.DeriveKey(cfg.Session.CookiePassword, hostmoves.PurposeConfirm)
	if err != nil {
		return nil, err
	}
	return &hostmoves.Service{
		ESPNOpen: e.connect, ESPNLineup: cfg.Hosts.ESPNLineupWrites, ESPNClaim: cfg.Hosts.ESPNClaimWrites, Links: &leaguesync.Store{Pool: pool}, Connections: ff.store,
		Member: e.member, Writer: e.client, Claims: e.client, Proofs: &hostmoves.Store{Pool: pool}, Signer: hostmoves.Signer{Key: key}, Now: time.Now, Log: log,
	}, nil
}

// leagueHost is the ESPN league host, nil when ESPN
// is off.
func (e espnWiring) leagueHost(log *slog.Logger) *leaguesync.ESPN {
	if !e.host {
		return nil
	}
	return &leaguesync.ESPN{Member: e.member, Public: e.client, Now: time.Now, Log: log}
}

// hostList is GET /hosts: every host open here, in the account page's order.
func hostList(ff ffpcWiring, y yahooWiring, e espnWiring, log *slog.Logger) []httpx.Route {
	var open []apitypes.ConnectedHost
	if ff.on {
		open = append(open, apitypes.ConnectedHostFfpc)
	}
	if y.on {
		open = append(open, apitypes.ConnectedHostYahoo)
	}
	if e.connect {
		open = append(open, apitypes.ConnectedHostEspn)
	}
	return (&hosts.List{Enabled: open, Store: ff.store, Log: log}).Routes()
}

// leagueSyncService wires league sync: Sleeper first, MyFantasyLeague
// second, FFPC third, Yahoo fourth and ESPN fifth behind one poller, the rooms' board, and the
// recorded leagues when COMPANION_REPLAY is on (development only). The
// host directories are read at start, so the first view finds them.
func leagueSyncService(cfg config.API, pool *pgxpool.Pool, board *draftroom.Boards, saved *leagues.Store, ents *entitlements.Store, accounts leaguesync.AccountViewer, ff ffpcWiring, y yahooWiring, e espnWiring, log *slog.Logger) *leaguesync.Service {
	now := time.Now
	var sleeperAPI leaguesync.SleeperAPI = sleeper.New()
	var mflAPI leaguesync.MFLAPI = mfl.New()
	if cfg.Dev.CompanionReplay {
		sleeperAPI = leaguesync.SleeperReplay{Live: sleeperAPI}
		mflAPI = leaguesync.MFLReplay{Live: mflAPI}
		log.Warn("league sync replay is on", "sleeper", leaguesync.ReplaySleeperLeague, "mfl", leaguesync.ReplayMFLLeague)
	}
	store := &leaguesync.Store{Pool: pool}
	hostList := leaguesync.Hosts{
		&leaguesync.Sleeper{API: sleeperAPI, Now: now},
		&leaguesync.MFL{API: mflAPI, Now: now},
	}
	ffpcHost := ff.host(store, board.Schedule, log)
	if ffpcHost != nil {
		hostList = append(hostList, ffpcHost)
	}
	if yahooHost := y.host(board.Schedule, log); yahooHost != nil {
		hostList = append(hostList, yahooHost)
	}
	if espnHost := e.leagueHost(log); espnHost != nil {
		hostList = append(hostList, espnHost)
	}
	players := &leaguesync.Directory{Hosts: hostList, Store: store, Now: now, Log: log}
	go players.Warm(context.Background(), cfg.Board.Season)
	return &leaguesync.Service{
		Hosts:     hostList,
		Poller:    &leaguesync.Poller{Hosts: hostList, Store: store, Now: now, Log: log},
		Admission: &leaguesync.Admission{Now: now},
		Players:   players,
		Links:     store, Saved: saved, Boards: board, FFPC: ffpcHost, Entitlements: ents, ESPN: espn.New(), Now: now, Log: log,
		Selection: store, Accounts: accounts,
	}
}
