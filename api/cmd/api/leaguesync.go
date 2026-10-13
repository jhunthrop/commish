package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/draftroom"
	"github.com/jhunthrop/commish/api/internal/hosts"
	"github.com/jhunthrop/commish/api/internal/hosts/ffpc"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/leagues"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
	"github.com/jhunthrop/commish/api/internal/mfl"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// ffpcWiring is FFPC read as connected members: the vault that opens
// their kept sign-in, the one client every read goes through (one
// request a second across the process), and the member reader.
type ffpcWiring struct {
	vault  *hosts.Vault
	store  *hosts.Store
	client *ffpc.Client
	member *ffpc.Member
}

func newFFPCWiring(cfg config.API, pool *pgxpool.Pool, log *slog.Logger) (ffpcWiring, error) {
	vault, err := hosts.NewVault(cfg.HostCredentialsKey)
	if err != nil {
		return ffpcWiring{}, err
	}
	if !vault.Ready() {
		log.Warn("host credentials key not set", "effect", "connecting FFPC answers 503")
	}
	store := &hosts.Store{Pool: pool}
	client := ffpc.New()
	member := &ffpc.Member{Client: client, Store: store, Vault: vault, Now: time.Now, Log: log}
	return ffpcWiring{vault: vault, store: store, client: client, member: member}, nil
}

// routes are connecting, listing and disconnecting FFPC.
func (f ffpcWiring) routes(log *slog.Logger) []httpx.Route {
	return (&ffpc.Service{Signer: f.client, Store: f.store, Vault: f.vault, Leagues: f.member, Now: time.Now, Log: log}).Routes()
}

// host is the FFPC league host over the link store, nil when the vault
// has no key (no connection could be opened).
func (f ffpcWiring) host(store *leaguesync.Store) *leaguesync.FFPC {
	if !f.vault.Ready() {
		return nil
	}
	return &leaguesync.FFPC{Member: f.member, Readers: store, Now: time.Now}
}

// leagueSyncService wires league sync: Sleeper first, MyFantasyLeague
// second and FFPC third behind one poller, the rooms' board, and the
// recorded leagues when COMPANION_REPLAY is on (development only). The
// host directories are read at start, so the first view finds them.
func leagueSyncService(cfg config.API, pool *pgxpool.Pool, board *draftroom.Boards, saved *leagues.Store, ff ffpcWiring, log *slog.Logger) *leaguesync.Service {
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
	ffpcHost := ff.host(store)
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
		Links:     store, Saved: saved, Boards: board, FFPC: ffpcHost, Now: now, Log: log,
	}
}
