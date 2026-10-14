package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/draftroom"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/ffpc"
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

// leagueSyncService wires league sync: Sleeper first, MyFantasyLeague
// second and FFPC third behind one poller, the rooms' board, and the
// recorded leagues when COMPANION_REPLAY is on (development only). The
// host directories are read at start, so the first view finds them.
func leagueSyncService(cfg config.API, pool *pgxpool.Pool, board *draftroom.Boards, saved *leagues.Store, ents *entitlements.Store, accounts leaguesync.AccountViewer, ff ffpcWiring, log *slog.Logger) *leaguesync.Service {
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
	players := &leaguesync.Directory{Hosts: hostList, Store: store, Now: now, Log: log}
	go players.Warm(context.Background(), cfg.Board.Season)
	return &leaguesync.Service{
		Hosts:     hostList,
		Poller:    &leaguesync.Poller{Hosts: hostList, Store: store, Now: now, Log: log},
		Admission: &leaguesync.Admission{Now: now},
		Players:   players,
		Links:     store, Saved: saved, Boards: board, FFPC: ffpcHost, Entitlements: ents, Now: now, Log: log,
		Selection: store, Accounts: accounts,
	}
}
