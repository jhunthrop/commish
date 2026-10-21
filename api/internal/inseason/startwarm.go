package inseason

import (
	"context"
	"fmt"
	"time"
)

// StartTimeout bounds the warm at start (Lane 112 ruling 1): past it the
// service starts anyway, and the reads still running land in the cache
// behind it.
const StartTimeout = 20 * time.Second

// WarmAtStart fills the season's reads and builds the run's boards at the
// clock before the service answers (warmSeason), waiting at most bound.
// It logs how long the warm took; a warm that fails or runs past bound is
// logged and the service starts, its first request filling as before.
func (s *Service) WarmAtStart(ctx context.Context, bound time.Duration) {
	start := time.Now()
	ctx, cancel := context.WithTimeout(ctx, bound)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- s.warmSeason(ctx) }()
	select {
	case err := <-done:
		if err != nil {
			s.Log.Warn("inseason: the warm at start failed; the first requests fill the reads", "ms", time.Since(start).Milliseconds(), "err", err)
			return
		}
		s.Log.Info("inseason: warmed at start", "ms", time.Since(start).Milliseconds(), "season", s.Season)
	case <-ctx.Done():
		s.Log.Warn("inseason: the warm at start ran past its bound; serving while it lands", "ms", time.Since(start).Milliseconds())
	}
}

// warmSeason fills the board season's facts (stat lines, games, game
// facts, the dated designations), the published projection of the week of
// the next game to play, of the week before it (a platform's week can
// still be the one just played) and of the week after, each where the
// schedule holds it, and builds every run format's board at the clock
// once: the reads the league screens, the order and the player page start
// from.
//
// The boards built here serve only the warm's own minute (LiveBoards holds
// one minute, and a build costs well under a millisecond); what the build
// leaves behind for the first requests is the board loads and the valued
// boards (draftroom.Boards), the reads that cost.
func (s *Service) warmSeason(ctx context.Context) error {
	data, err := s.Facts.Data(ctx, s.Season)
	if err != nil {
		return fmt.Errorf("facts: %w", err)
	}
	next := nextWeek(data.Games)
	for _, week := range []int{next - 1, next, next + 1} {
		if hasGames(data.Games, week) {
			s.projection(ctx, s.Season, week)
		}
	}
	if _, err := liveRunBoards(ctx, s.Boards, data.Games, s.Now(), s.Lives); err != nil {
		return fmt.Errorf("boards: %w", err)
	}
	return nil
}
