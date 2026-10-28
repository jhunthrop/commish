package notify

import (
	"context"
	"log/slog"
	"time"
)

// CatchUpRunner is the producer's catch-up. *CatchUp implements it.
type CatchUpRunner interface {
	Run(ctx context.Context) (Produced, bool, error)
}

// DrainRunner is the outbox's drain. *Drainer implements it.
type DrainRunner interface {
	Run(ctx context.Context) (Drained, error)
}

// Pass is one notify run: the catch-up on its own deadline, then the
// drain, so a slow catch-up never starves the drain of every other push
// (re-review N17). A catch-up cut at its deadline does not move its mark
// and resumes at the next run; its failure is logged and the drain runs.
type Pass struct {
	CatchUp       CatchUpRunner
	Drain         DrainRunner
	CatchUpBudget time.Duration
	Log           *slog.Logger
}

// Run is the pass.
func (p *Pass) Run(ctx context.Context) (Drained, error) {
	catchCtx, stop := context.WithTimeout(ctx, p.CatchUpBudget)
	_, _, err := p.CatchUp.Run(catchCtx)
	stop()
	if err != nil {
		p.Log.Error("notify: starter status catch-up failed", "err", err)
	}
	return p.Drain.Run(ctx)
}
