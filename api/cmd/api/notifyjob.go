package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/db"
	"github.com/jhunthrop/commish/api/internal/draftroom"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
	"github.com/jhunthrop/commish/api/internal/notify"
)

// notifyJob is the push job's name: the Cloud Run job api-notify, every
// minute in season (Lane 262, spec §5.3).
const notifyJob = "notify"

// The job's time inside api-notify's 90 s task timeout (api.yml): the
// catch-up stops at 20 s, so a slow one never starves the drain (re-review
// N17; a cut catch-up does not move its mark and resumes next minute
// after the last account it finished, Lane 285);
// the drain claims for 45 s and sends nothing past 80 s from the
// run's start, releasing what it did not try, so the task is never killed
// mid-send.
const (
	catchUpBudget = 20 * time.Second
	drainBudget   = 45 * time.Second
	jobDeadline   = 80 * time.Second
)

// runNotify is one api-notify execution, on the job's own narrow
// configuration (config.LoadNotify: the database, the board and push,
// nothing of the API's secrets). Holding the notify lock, one process at
// a time, it first catches the starter status producer up (every capture
// pair since its mark), then drains the outbox: FCM with the runtime's own
// identity, APNs not configured until its key is in Secret Manager. A
// failed catch-up is logged as an error and the drain still runs.
func runNotify(ctx context.Context, log *slog.Logger) error {
	log = log.With("job", notifyJob)
	cfg, err := config.LoadNotify(os.Getenv)
	if err != nil {
		return err
	}
	pool, err := db.Connect(ctx, cfg.Database.URL)
	if err != nil {
		return err
	}
	defer pool.Close()
	store := &notify.Store{Pool: pool}
	catchUp, closeBoards, err := starterCatchUp(pool, cfg, store, log)
	if err != nil {
		return err
	}
	defer closeBoards()
	senders, err := pushSenders(ctx, cfg.Push, store, log)
	if err != nil {
		return err
	}
	drainer := &notify.Drainer{Outbox: store, Senders: senders, Now: time.Now, Log: log, Budget: drainBudget}
	ctx, cancel := context.WithTimeout(ctx, jobDeadline)
	defer cancel()
	pass := &notify.Pass{CatchUp: catchUp, Drain: drainer, CatchUpBudget: catchUpBudget, Log: log}
	ran, err := store.Exclusive(ctx, func(ctx context.Context) error {
		n, err := pass.Run(ctx)
		log.Info("notified", "sent", n.Sent, "retried", n.Retried, "dead", n.Dead, "dropped_tokens", n.DroppedTokens,
			"released", n.Released, "lost", n.Lost)
		return err
	})
	if err != nil {
		return fmt.Errorf("%s: %w", notifyJob, err)
	}
	if !ran {
		log.Warn("notify: another run holds the lock; this one did nothing")
	}
	return nil
}

// starterCatchUp wires the starter status producer from the store alone:
// the capture pairs from the board's research tables, each member's
// starters from the league reads and directories the API kept.
func starterCatchUp(pool *pgxpool.Pool, cfg config.Notify, store *notify.Store, log *slog.Logger) (*notify.CatchUp, func(), error) {
	boards, closeBoards, err := draftroom.OpenBoards(pool, cfg.Board, time.Now, log)
	if err != nil {
		return nil, nil, err
	}
	leagues := &leaguesync.Store{Pool: pool}
	producer := &notify.StarterStatus{
		Designations: boards.Schedule,
		Lineups: &leaguesync.StoredStarters{
			Links: leagues, Snapshots: leagues, Directory: leagues, Boards: boards, Log: log, Now: time.Now,
		},
		Queue: store, Now: time.Now, Log: log,
	}
	return &notify.CatchUp{Marks: store, Captures: boards.Schedule, StarterStatus: producer, Now: time.Now, Log: log}, closeBoards, nil
}

// pushSenders is each platform's sender, the not-configured one where its
// credentials are not here.
func pushSenders(ctx context.Context, cfg config.Push, tokens notify.ProviderTokens, log *slog.Logger) (map[notify.Platform]notify.Sender, error) {
	fcm, err := notify.NewFCM(ctx, cfg.FCMProjectID)
	if err != nil {
		return nil, err
	}
	origin := notify.APNsProduction
	if cfg.APNsSandbox {
		origin = notify.APNsSandbox
	}
	apns, err := notify.NewAPNs(notify.APNsConfig{
		KeyID: cfg.APNsKeyID, TeamID: cfg.APNsTeamID, Key: cfg.APNsKey, Topic: cfg.APNsTopic, Origin: origin,
	}, &http.Client{}, tokens, time.Now)
	if err != nil {
		return nil, err
	}
	if cfg.FCMProjectID == "" {
		log.Warn("fcm not configured", "effect", "FCM_PROJECT_ID is unset; android pushes are given up")
	}
	if !cfg.APNsConfigured() {
		log.Warn("apns not configured", "effect", "APNS_KEY_ID, APNS_TEAM_ID and APNS_KEY are unset; apns pushes are given up")
	}
	return map[notify.Platform]notify.Sender{notify.PlatformFCM: fcm, notify.PlatformAPNS: apns}, nil
}
