package main

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/db"
)

// reconnects is how many tab closes the reconnect drafter makes.
const reconnects = 8

// lobbyRun is what every drafter's goroutine shares.
type lobbyRun struct {
	teams   int
	board   []string
	leaver  int // the seat whose drafter closes the tab
	again   int // the seat whose drafter closes and reopens
	leaveAt int

	mu          sync.Mutex
	started     time.Time
	sent        map[int]time.Time
	broadcast   []time.Duration
	leftAt      time.Time
	replaced    time.Duration
	standIn     time.Duration
	standInSeen chan struct{}
	reconnected []time.Duration
	done        sync.WaitGroup
}

// measureLobby seats people drafters in one room of the format, plays
// the draft over the sockets, and measures the fill, the broadcast from
// a pick to every other drafter, a tab closed and its seat handed to a
// stand-in before its clock, reconnects, and the report.
func measureLobby(ctx context.Context, env environment, format string, people int) error {
	drafters := make([]*drafter, people)
	for i := range drafters {
		d, err := mint(ctx, env, handleFor("lobby", i))
		if err != nil {
			return err
		}
		drafters[i] = d
	}
	seats := make([]apitypes.LobbySeat, people)
	began := time.Now()
	var wg sync.WaitGroup
	errs := make(chan error, people)
	for i, d := range drafters {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, err := d.call(ctx, http.MethodPost, "/lobbies/join", apitypes.LobbyJoin{Format: apitypes.LobbyFormat(format)}, &seats[i])
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			return err
		}
	}
	room := seats[0].RoomId
	for _, s := range seats {
		if s.RoomId != room {
			return fmt.Errorf("the drafters landed in different rooms: %s and %s", room, s.RoomId)
		}
	}
	var view apitypes.LobbyRoom
	if _, _, err := drafters[0].call(ctx, http.MethodGet, "/lobbies/"+room.String(), nil, &view); err != nil {
		return err
	}
	run := &lobbyRun{teams: view.Teams, board: ids(view.Board.Players), sent: map[int]time.Time{}, standInSeen: make(chan struct{})}
	run.leaveAt = 2*run.teams + 1
	run.leaver = snakeSeat(run.leaveAt+3, run.teams)
	run.again = snakeSeat(run.leaveAt+run.teams/2, run.teams)
	for i, d := range drafters {
		run.done.Add(1)
		go func() {
			defer run.done.Done()
			if err := run.play(ctx, env, d, seats[i]); err != nil {
				fmt.Println("drafter", d.Handle, "stopped:", err)
			}
		}()
	}
	run.done.Wait()
	fill := run.started.Sub(began)
	var report apitypes.MockReport
	_, reportTook, err := drafters[0].call(ctx, http.MethodGet, "/lobbies/"+room.String()+"/report", nil, &report)
	if err != nil {
		return err
	}
	written, err := lobbyPicks(ctx, env, room)
	if err != nil {
		return err
	}
	fmt.Printf("room %s, %s, %d people, %d seats\n", room, format, people, run.teams)
	fmt.Printf("%-44s %.1f s\n", "fill, first join to the draft starting", fill.Seconds())
	line("broadcast, pick sent to every other drafter", summarize(run.broadcast))
	fmt.Printf("%-44s %.0f ms (clock %d s)\n", "tab closed to the seat handed to a stand-in", float64(run.replaced.Microseconds())/1000, view.ClockSeconds)
	fmt.Printf("%-44s %.0f ms after the turn began\n", "the stand-in's pick", float64(run.standIn.Microseconds())/1000)
	line("reconnect, dial to the welcome", summarize(run.reconnected))
	fmt.Printf("%-44s %.0f ms (computed %d ms)\n", "report", float64(reportTook.Microseconds())/1000, report.ComputedMs)
	fmt.Printf("%-44s %d of %d\n", "picks written to lobby_picks", written, run.teams*view.Rounds)
	return nil
}

func lobbyPicks(ctx context.Context, env environment, room uuid.UUID) (int, error) {
	pool, err := db.Open(env.DatabaseURL)
	if err != nil {
		return 0, err
	}
	defer pool.Close()
	var n int
	err = pool.QueryRow(ctx, `select count(*) from app.lobby_picks where room_id = $1`, room).Scan(&n)
	return n, err
}

// play is one drafter: pick the first player left in the order drafters
// take them whenever on the clock, measure what the run asks of this seat.
func (run *lobbyRun) play(ctx context.Context, env environment, d *drafter, seat apitypes.LobbySeat) error {
	url := socketURL(env.API, seat.SocketUrl)
	sock, welcome, _, err := dial(ctx, d, url, 0)
	if err != nil {
		return err
	}
	st := &drafterState{seat: seat.Seat, drafted: map[string]bool{}, tried: map[int]int{}}
	if err := run.apply(ctx, sock, st, welcome); err != nil {
		return err
	}
	for {
		f, ok := <-sock.frames
		if !ok {
			return nil
		}
		if f.Type == "error" {
			st.tried[st.next]++
			if err := run.maybePick(ctx, sock, st); err != nil {
				return err
			}
			continue
		}
		if err := run.apply(ctx, sock, st, f); err != nil {
			return err
		}
		if st.complete {
			sock.close()
			return nil
		}
		switch {
		case st.seat == run.leaver && !st.left && st.next == run.leaveAt:
			if sock, err = run.closeAndReturn(ctx, d, url, sock, st); err != nil {
				return err
			}
		case st.seat == run.again && st.reopened < reconnects && st.next >= run.leaveAt+1:
			for st.reopened < reconnects {
				sock.close()
				var welcome frame
				var took time.Duration
				if sock, welcome, took, err = dial(ctx, d, url, st.seq); err != nil {
					return err
				}
				run.mu.Lock()
				run.reconnected = append(run.reconnected, took)
				run.mu.Unlock()
				st.reopened++
				if err := run.apply(ctx, sock, st, welcome); err != nil {
					return err
				}
			}
		}
	}
}

// closeAndReturn closes the leaver's tab, waits for its stand-in's pick,
// and reconnects from the last seq it applied.
func (run *lobbyRun) closeAndReturn(ctx context.Context, d *drafter, url string, sock *socket, st *drafterState) (*socket, error) {
	run.mu.Lock()
	run.leftAt = time.Now()
	run.mu.Unlock()
	sock.close()
	st.left = true
	select {
	case <-run.standInSeen:
	case <-time.After(2 * time.Minute):
		return nil, fmt.Errorf("no stand-in picked for seat %d", st.seat)
	}
	next, welcome, took, err := dial(ctx, d, url, st.seq)
	if err != nil {
		return nil, err
	}
	run.mu.Lock()
	run.reconnected = append(run.reconnected, took)
	run.mu.Unlock()
	return next, run.apply(ctx, next, st, welcome)
}

type drafterState struct {
	seat      int
	seq       int64
	next      int
	drafting  bool
	complete  bool
	left      bool
	reopened  int
	drafted   map[string]bool
	tried     map[int]int
	turnBegan time.Time
}

// apply reads a frame's actions, takes the measurements they close, and
// picks when the drafter is on the clock.
func (run *lobbyRun) apply(ctx context.Context, sock *socket, st *drafterState, f frame) error {
	for _, a := range f.Actions {
		if a.Seq <= st.seq {
			continue
		}
		st.seq = a.Seq
		switch a.Kind {
		case "ROOM_STARTED":
			run.mu.Lock()
			if run.started.IsZero() {
				run.started = f.At
			}
			run.mu.Unlock()
		case "START_DRAFT":
			st.drafting, st.next = true, 1
		case "SEAT_LEFT":
			if a.Seat != nil && *a.Seat == run.leaver && st.seat != run.leaver {
				run.mu.Lock()
				if run.replaced == 0 && !run.leftAt.IsZero() {
					run.replaced = f.At.Sub(run.leftAt)
				}
				run.mu.Unlock()
			}
		case "ROOM_COMPLETE":
			st.complete = true
		case "MAKE_PICK", "TIMER_EXPIRE":
			n, ok := noteOf(a)
			if !ok {
				continue
			}
			st.drafted[n.PlayerID] = true
			st.next = n.Pick + 1
			run.mu.Lock()
			if sent, ok := run.sent[n.Pick]; ok && n.Seat != st.seat {
				run.broadcast = append(run.broadcast, f.At.Sub(sent))
			}
			if n.Seat == run.leaver && n.By == "queue" && run.standIn == 0 && st.seat != run.leaver {
				run.standIn = a.At.Sub(st.turnBegan)
				close(run.standInSeen)
			}
			run.mu.Unlock()
			st.turnBegan = a.At
		}
		if a.Kind == "START_DRAFT" {
			st.turnBegan = a.At
		}
	}
	return run.maybePick(ctx, sock, st)
}

// maybePick sends this drafter's pick when the room is on its seat.
func (run *lobbyRun) maybePick(ctx context.Context, sock *socket, st *drafterState) error {
	if !st.drafting || st.complete || snakeSeat(st.next, run.teams) != st.seat {
		return nil
	}
	skip := st.tried[st.next]
	for _, id := range run.board {
		if st.drafted[id] {
			continue
		}
		if skip > 0 {
			skip--
			continue
		}
		pick := st.next
		run.mu.Lock()
		run.sent[pick] = time.Now()
		run.mu.Unlock()
		return sock.send(ctx, apitypes.RoomCommand{Type: apitypes.RoomCommandTypePick, PlayerId: &id, Pick: &pick})
	}
	return fmt.Errorf("seat %d has nobody to pick at %d", st.seat, st.next)
}
