package main

import (
	"log/slog"
	"runtime"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/advisor"
	"github.com/jhunthrop/commish/api/internal/companion"
	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/entitlements"
	"github.com/jhunthrop/commish/api/internal/sim"
	"github.com/jhunthrop/commish/api/internal/sleeper"
	"github.com/jhunthrop/commish/api/internal/solo"
)

// companionService wires the live-draft companion: Sleeper through one
// client and one shared poller, the rooms' board and card, and the
// recorded draft when COMPANION_REPLAY is on (development only).
func companionService(cfg config.API, pool *pgxpool.Pool, rooms *solo.Service, ents *entitlements.Store, ff ffpcWiring, log *slog.Logger) (*companion.Service, error) {
	host := sleeper.New()
	s := &companion.Service{
		Store: &companion.Store{Pool: pool}, Poller: &companion.Poller{Host: host, Now: time.Now}, Directory: host,
		Boards: rooms.Boards, Matcher: &companion.NameMatcher{}, Advisor: rooms.Advisor, Entitlements: ents,
		Conditional:   advisor.Engine{Runs: sim.RoomOddsRuns, Workers: runtime.GOMAXPROCS(0)},
		ReportWorkers: runtime.GOMAXPROCS(0), Now: time.Now, Log: log,
	}
	if ff.vault.Ready() {
		s.FFPC = &companion.FFPCDrafts{Member: ff.member, Now: time.Now}
	}
	if cfg.Dev.CompanionReplay {
		replay, err := companion.LoadReplay()
		if err != nil {
			return nil, err
		}
		s.Replay = &replay
		log.Warn("companion replay is on", "draft", companion.ReplayDraftID)
	}
	return s, nil
}
