package main

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// fakePruner answers one prune, recording the cut it was asked for.
type fakePruner struct {
	n      int64
	err    error
	before time.Time
}

func (f *fakePruner) PruneOfferReads(_ context.Context, before time.Time) (int64, error) {
	f.before = before
	return f.n, f.err
}

// The sweep's archive prune cuts at OfferReadsKept; a failure is one
// error line and never a return, so it cannot stop the sweep (review M3).
func TestPruneOfferReadsStep(t *testing.T) {
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name string
		p    *fakePruner
		want string
	}{
		{"pruned", &fakePruner{n: 7}, `level=INFO msg="pruned archived host offer reads" deleted=7`},
		{"failed", &fakePruner{n: 2, err: errors.New("the archive is locked")}, `level=ERROR msg="sweep: archived host offer reads not pruned" deleted=2`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var out bytes.Buffer
			pruneOfferReads(context.Background(), slog.New(slog.NewTextHandler(&out, nil)), c.p, now)
			if !strings.Contains(out.String(), c.want) {
				t.Fatalf("logged %q, want %q", out.String(), c.want)
			}
			if !c.p.before.Equal(now.Add(-leaguesync.OfferReadsKept)) {
				t.Fatalf("cut at %v", c.p.before)
			}
		})
	}
}
