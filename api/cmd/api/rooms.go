package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"runtime"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/api/idtoken"

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

// advisorClient is the HTTP client the card calls the advisor with. The
// advisor runs on Cloud Run behind IAM (ingress all, run.invoker granted to
// api-runtime), so an https advisor is called with a Google identity token
// whose audience is its URL, minted from the service account the API runs
// as. A plain http advisor is a local one (docker on localhost) and needs
// none. A failed call still falls back to the engine (advisor.Fallback);
// only a token source that cannot be built at all stops the start, since
// that is a deploy without credentials, not a slow advisor.
func advisorClient(ctx context.Context, cfg config.Advisor) (*http.Client, error) {
	if !strings.HasPrefix(cfg.URL, "https://") {
		return &http.Client{Timeout: cfg.Timeout}, nil
	}
	client, err := idtoken.NewClient(ctx, cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("advisor: identity token client for %s: %w", cfg.URL, err)
	}
	client.Timeout = cfg.Timeout
	return client, nil
}

// rooms wires the solo room and the lobby's request API: the board from
// the research tables, the advisor with the engine behind it, and the
// engine's own runs for the report. The board's pool, when it has one of
// its own, lives as long as the process.
func rooms(ctx context.Context, cfg config.API, pool *pgxpool.Pool, mockStore *mocks.Store, anon *auth.Anon, gate *leagues.Gate, leagueStore *leagues.Store, sheetStore *sheets.Store,
	authStore *auth.Store, log *slog.Logger) (*solo.Service, *lobby.Handler, error) {
	draftBoards, _, err := draftroom.OpenBoards(pool, cfg.Board, time.Now)
	if err != nil {
		return nil, nil, err
	}
	workers := runtime.GOMAXPROCS(0)
	engine := advisor.Engine{Runs: sim.RoomOddsRuns, Workers: workers}
	card := advisor.Fallback{Secondary: engine, Timeout: cfg.Advisor.Timeout, Log: log}
	if cfg.Advisor.URL != "" {
		client, err := advisorClient(ctx, cfg.Advisor)
		if err != nil {
			return nil, nil, err
		}
		card.Primary = advisor.HTTP{BaseURL: cfg.Advisor.URL, Client: client}
	} else {
		log.Warn("advisor not configured", "effect", "the room's card comes from the engine's room odds")
	}
	shares, err := solo.NewShareSigner(cfg.ShareLinkKeys)
	if err != nil {
		return nil, nil, err
	}
	hindsight := mock.SimOdds{Runs: sim.RoomOddsRuns, Workers: workers}
	soloService := &solo.Service{
		Mocks: mockStore, Anon: anon, Leagues: leagueStore, Gate: gate, Sheets: sheetStore, Boards: draftBoards,
		Advisor: card, Hindsight: hindsight, ReportWorkers: workers, Site: cfg.HTTP.PublicBaseURL, Shares: shares, Now: time.Now, Log: log,
	}
	lobbyHandler := &lobby.Handler{
		Store: &lobby.Store{Pool: pool, Now: time.Now}, Boards: draftBoards, Advisor: card, Engine: engine,
		Hindsight: hindsight, Workers: workers, Handles: authStore, RoomBaseURL: cfg.RoomBaseURL, Log: log,
	}
	return soloService, lobbyHandler, nil
}
