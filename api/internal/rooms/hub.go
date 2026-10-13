package rooms

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/jhunthrop/commish/api/internal/lobby"
)

// relistenAfter is the pause before the hub listens again after its
// connection drops.
const relistenAfter = time.Second

// Hub carries a room's writes to every socket and clock this instance
// holds on it, from any instance: every write to a room's log notifies
// lobby.NotifyChannel at commit, and the hub LISTENs on one direct
// connection (a transaction pooler cannot carry LISTEN).
type Hub struct {
	URL string
	Log *slog.Logger

	mu   sync.Mutex
	subs map[uuid.UUID]map[chan struct{}]struct{}
	wake chan struct{}
}

// Subscribe signals ch whenever the room's log moves. A signal carries no
// data: the subscriber reads the log from its own last seq, so a signal
// dropped on a full channel loses nothing.
func (h *Hub) Subscribe(id uuid.UUID) (<-chan struct{}, func()) {
	ch := make(chan struct{}, 1)
	h.mu.Lock()
	if h.subs == nil {
		h.subs = map[uuid.UUID]map[chan struct{}]struct{}{}
	}
	if h.subs[id] == nil {
		h.subs[id] = map[chan struct{}]struct{}{}
	}
	h.subs[id][ch] = struct{}{}
	if h.wake == nil {
		h.wake = make(chan struct{}, 1)
	}
	select {
	case h.wake <- struct{}{}:
	default:
	}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		delete(h.subs[id], ch)
		if len(h.subs[id]) == 0 {
			delete(h.subs, id)
		}
	}
}

// Signal wakes everything this instance holds on the room. A write made
// here signals at once, ahead of its notification.
func (h *Hub) Signal(id uuid.UUID) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs[id] {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (h *Hub) signalAll() {
	h.mu.Lock()
	ids := make([]uuid.UUID, 0, len(h.subs))
	for id := range h.subs {
		ids = append(ids, id)
	}
	h.mu.Unlock()
	for _, id := range ids {
		h.Signal(id)
	}
}

// Run listens until ctx ends, and only while something on this instance
// is subscribed (a socket or a room's clock): an idle instance holds no
// connection, so the database can suspend. It listens again after a
// dropped connection; every room is signalled after each (re)connect,
// since a notification sent while it was down is gone.
func (h *Hub) Run(ctx context.Context) {
	for ctx.Err() == nil {
		if !h.wanted() {
			select {
			case <-ctx.Done():
				return
			case <-h.wakeup():
			}
			continue
		}
		if err := h.listen(ctx); err != nil && ctx.Err() == nil {
			h.Log.Warn("rooms: listen", "err", err)
		}
		select {
		case <-ctx.Done():
		case <-time.After(relistenAfter):
		}
	}
}

// Listen timings: a connect gives up after connectTimeout, and a quiet
// connection is pinged every checkEvery, so a half-open one is found in
// seconds rather than at TCP keepalive's minutes.
const (
	connectTimeout = 10 * time.Second
	checkEvery     = 15 * time.Second
	checkTimeout   = 5 * time.Second
)

func (h *Hub) listen(ctx context.Context) error {
	cctx, cancel := context.WithTimeout(ctx, connectTimeout)
	conn, err := pgx.Connect(cctx, h.URL)
	cancel()
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close(context.Background()) }()
	if _, err := conn.Exec(ctx, "listen "+lobby.NotifyChannel); err != nil {
		return err
	}
	h.signalAll()
	for {
		wctx, cancel := context.WithTimeout(ctx, checkEvery)
		n, err := conn.WaitForNotification(wctx)
		cancel()
		switch {
		case err == nil:
			room, _, _ := strings.Cut(n.Payload, ":")
			if id, err := uuid.Parse(room); err == nil {
				h.Signal(id)
			}
		case ctx.Err() != nil:
			return ctx.Err()
		case errors.Is(err, context.DeadlineExceeded):
			if !h.wanted() {
				return nil
			}
			pctx, cancel := context.WithTimeout(ctx, checkTimeout)
			err := conn.Ping(pctx)
			cancel()
			if err != nil {
				return err
			}
		default:
			return err
		}
	}
}

// wanted reports whether anything on this instance is subscribed.
func (h *Hub) wanted() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs) > 0
}

// wakeup is signalled when a first subscriber arrives.
func (h *Hub) wakeup() <-chan struct{} {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.wake == nil {
		h.wake = make(chan struct{}, 1)
	}
	return h.wake
}
