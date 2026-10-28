package main

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jhunthrop/commish/api/internal/config"
	"github.com/jhunthrop/commish/api/internal/notify"
)

// runNotify drains the push outbox once (Lane 262, spec §5.3): the Cloud
// Run job api-notify, every minute in season. FCM sends with the runtime's
// own identity; APNs answers not configured until its key is in Secret
// Manager, and those rows are given up and logged.
func runNotify(ctx context.Context, log *slog.Logger, cfg config.API, pool *pgxpool.Pool, _ []string) error {
	senders, err := pushSenders(ctx, cfg.Push, log)
	if err != nil {
		return err
	}
	d := &notify.Drainer{Outbox: &notify.Store{Pool: pool}, Senders: senders, Now: time.Now, Log: log}
	n, err := d.Run(ctx)
	log.Info("notified", "sent", n.Sent, "retried", n.Retried, "dead", n.Dead, "dropped_tokens", n.DroppedTokens)
	return err
}

// pushSenders is each platform's sender, the not-configured one where its
// credentials are not here.
func pushSenders(ctx context.Context, cfg config.Push, log *slog.Logger) (map[notify.Platform]notify.Sender, error) {
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
	}, &http.Client{}, time.Now)
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
