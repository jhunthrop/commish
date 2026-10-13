package rooms

import (
	"context"
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

// Run listens until ctx ends, listening again after a dropped
// connection; every room is signalled after each (re)connect, since a
// notification sent while it was down is gone.
func (h *Hub) Run(ctx context.Context) {
	for ctx.Err() == nil {
		if err := h.listen(ctx); err != nil && ctx.Err() == nil {
			h.Log.Warn("rooms: listen", "err", err)
		}
		select {
		case <-ctx.Done():
		case <-time.After(relistenAfter):
		}
	}
}

func (h *Hub) listen(ctx context.Context) error {
	conn, err := pgx.Connect(ctx, h.URL)
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close(context.Background()) }()
	if _, err := conn.Exec(ctx, "listen "+lobby.NotifyChannel); err != nil {
		return err
	}
	h.signalAll()
	for {
		n, err := conn.WaitForNotification(ctx)
		if err != nil {
			return err
		}
		room, _, _ := strings.Cut(n.Payload, ":")
		if id, err := uuid.Parse(room); err == nil {
			h.Signal(id)
		}
	}
}
