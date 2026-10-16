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
	"github.com/jhunthrop/commish/api/internal/boards"
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

// serviceClient is the HTTP client a research service (the advisor, the
// boards service) is called with. Each runs on Cloud Run behind IAM
// (ingress all, run.invoker granted to api-runtime), so an https service
// is called with a Google identity token whose audience is its URL,
// minted from the service account the API runs as. A plain http one is
// local (docker on localhost) and needs none. Only a token source that
// cannot be built at all stops the start, since that is a deploy without
// credentials, not a slow service.
func serviceClient(ctx context.Context, url string, timeout time.Duration) (*http.Client, error) {
	if !strings.HasPrefix(url, "https://") {
		return &http.Client{Timeout: timeout}, nil
	}
	client, err := idtoken.NewClient(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("identity token client for %s: %w", url, err)
	}
	client.Timeout = timeout
	return client, nil
}

// customBoards wires the boards service into the rooms' boards: a
// league's own rules scored exactly. Unconfigured, custom scoring answers
// that it cannot be built right now, never a stored board in its place.
func customBoards(ctx context.Context, cfg config.Board, b *draftroom.Boards, now func() time.Time, log *slog.Logger) error {
	if cfg.ServiceURL == "" {
		log.Warn("boards service not configured", "effect", "a league's own scoring cannot be drafted")
		return nil
	}
	client, err := serviceClient(ctx, cfg.ServiceURL, cfg.ServiceTimeout)
	if err != nil {
		return fmt.Errorf("boards: %w", err)
	}
	b.Custom = &boards.CustomSource{
		BaseURL: cfg.ServiceURL, Client: client, Season: cfg.Season, Directory: b.Schedule, TTL: cfg.TTL, Now: now,
	}
	return nil
}

// rooms wires the solo room and the lobby's request API: the board from
// the research tables, the advisor with the engine behind it, and the
// engine's own runs for the report. The board's pool, when it has one of
// its own, lives as long as the process.
func rooms(ctx context.Context, cfg config.API, pool *pgxpool.Pool, draftBoards *draftroom.Boards, mockStore *mocks.Store, anon *auth.Anon, gate *leagues.Gate, leagueStore *leagues.Store, sheetStore *sheets.Store,
	authStore *auth.Store, designations solo.DesignationSource, log *slog.Logger) (*solo.Service, *lobby.Handler, error) {
	workers := runtime.GOMAXPROCS(0)
	engine := advisor.Engine{Runs: sim.RoomOddsRuns, Workers: workers}
	card := advisor.Fallback{Secondary: engine, Timeout: cfg.Advisor.Timeout, Log: log}
	if cfg.Advisor.URL != "" {
		client, err := serviceClient(ctx, cfg.Advisor.URL, cfg.Advisor.Timeout)
		if err != nil {
			return nil, nil, fmt.Errorf("advisor: %w", err)
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
		Designations: designations, Advisor: card, Hindsight: hindsight, ReportWorkers: workers, Site: cfg.HTTP.PublicBaseURL, Shares: shares, Now: time.Now, Log: log,
	}
	lobbyHandler := &lobby.Handler{
		Store: &lobby.Store{Pool: pool, Now: time.Now}, Boards: draftBoards, Advisor: card, Engine: engine,
		Hindsight: hindsight, Workers: workers, Handles: authStore, RoomBaseURL: cfg.RoomBaseURL, Log: log,
	}
	return soloService, lobbyHandler, nil
}
