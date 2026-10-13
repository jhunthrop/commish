package main

import (
	"log/slog"
	"net/http"
	"runtime"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/advisor"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/draftroom"
	"github.com/jhunthrop/commish/api/internal/leagues"
	"github.com/jhunthrop/commish/api/internal/lobby"
	"github.com/jhunthrop/commish/api/internal/mock"
	"github.com/jhunthrop/commish/api/internal/mocks"
	"github.com/jhunthrop/commish/api/internal/sheets"
	"github.com/jhunthrop/commish/api/internal/sim"
	"github.com/jhunthrop/commish/api/internal/solo"
)

// rooms wires the solo room and the lobby's request API: the board from
// the research tables, the advisor with the engine behind it, and the
// engine's own runs for the report. The board's pool, when it has one of
// its own, lives as long as the process.
func rooms(cfg config.API, pool *pgxpool.Pool, mockStore *mocks.Store, anon *auth.Anon, gate *leagues.Gate, leagueStore *leagues.Store, sheetStore *sheets.Store,
	authStore *auth.Store, log *slog.Logger) (*solo.Service, *lobby.Handler, error) {
	draftBoards, _, err := draftroom.OpenBoards(pool, cfg.Board, time.Now)
	if err != nil {
		return nil, nil, err
	}
	workers := runtime.GOMAXPROCS(0)
	engine := advisor.Engine{Runs: sim.RoomOddsRuns, Workers: workers}
	card := advisor.Fallback{Secondary: engine, Timeout: cfg.Advisor.Timeout, Log: log}
	if cfg.Advisor.URL != "" {
		card.Primary = advisor.HTTP{BaseURL: cfg.Advisor.URL, Client: &http.Client{Timeout: cfg.Advisor.Timeout}}
	} else {
		log.Warn("advisor not configured", "effect", "the room's card comes from the engine's room odds")
	}
	hindsight := mock.SimOdds{Runs: sim.RoomOddsRuns, Workers: workers}
	soloService := &solo.Service{
		Mocks: mockStore, Anon: anon, Leagues: leagueStore, Gate: gate, Sheets: sheetStore, Boards: draftBoards,
		Advisor: card, Hindsight: hindsight, ReportWorkers: workers, Site: cfg.HTTP.PublicBaseURL, Now: time.Now, Log: log,
	}
	lobbyHandler := &lobby.Handler{
		Store: &lobby.Store{Pool: pool, Now: time.Now}, Boards: draftBoards, Advisor: card, Engine: engine,
		Hindsight: hindsight, Workers: workers, Handles: authStore, RoomBaseURL: cfg.RoomBaseURL, Log: log,
	}
	return soloService, lobbyHandler, nil
}
