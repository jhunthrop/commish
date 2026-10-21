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
// facts, the designations), the published projection of the week of the
// next game to play and of the week after when the schedule holds it, and
// builds every run format's board at the clock once: the reads the
// league screens, the order and the player page start from.
func (s *Service) warmSeason(ctx context.Context) error {
	data, err := s.Facts.Data(ctx, s.Season)
	if err != nil {
		return fmt.Errorf("facts: %w", err)
	}
	week := nextWeek(data.Games)
	s.projection(ctx, s.Season, week)
	if hasGames(data.Games, week+1) {
		s.projection(ctx, s.Season, week+1)
	}
	if _, err := liveRunBoards(ctx, s.Boards, data.Games, s.Now(), s.Lives); err != nil {
		return fmt.Errorf("boards: %w", err)
	}
	return nil
}
