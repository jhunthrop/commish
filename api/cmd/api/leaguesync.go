package main

import (
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/draftroom"
	"github.com/jhunthrop/commish/api/internal/leagues"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
	"github.com/jhunthrop/commish/api/internal/mfl"
	"github.com/jhunthrop/commish/api/internal/sleeper"
)

// leagueSyncService wires league sync: Sleeper first and MyFantasyLeague
// second behind one poller, the rooms' board, and the recorded leagues
// when COMPANION_REPLAY is on (development only).
func leagueSyncService(cfg config.API, pool *pgxpool.Pool, board *draftroom.Boards, saved *leagues.Store, log *slog.Logger) *leaguesync.Service {
	now := time.Now
	var sleeperAPI leaguesync.SleeperAPI = sleeper.New()
	var mflAPI leaguesync.MFLAPI = mfl.New()
	if cfg.Dev.CompanionReplay {
		sleeperAPI = leaguesync.SleeperReplay{Live: sleeperAPI}
		mflAPI = leaguesync.MFLReplay{Live: mflAPI}
		log.Warn("league sync replay is on", "sleeper", leaguesync.ReplaySleeperLeague, "mfl", leaguesync.ReplayMFLLeague)
	}
	hosts := leaguesync.Hosts{
		&leaguesync.Sleeper{API: sleeperAPI, Now: now},
		&leaguesync.MFL{API: mflAPI, Now: now},
	}
	store := &leaguesync.Store{Pool: pool}
	return &leaguesync.Service{
		Hosts:   hosts,
		Poller:  &leaguesync.Poller{Hosts: hosts, Store: store, Now: now, Log: log},
		Players: &leaguesync.Directory{Hosts: hosts, Store: store, Now: now, Log: log},
		Links:   store, Saved: saved, Boards: board, Now: now, Log: log,
	}
}
