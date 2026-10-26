// Command lobbyrecord records a lobby drafted by people against a local
// api and room service, for the apps' lobby fixture
// (shared/fixtures/lobby-room, Lane 229). It mints its drafters' sessions
// straight into the database it is pointed at, the way roommeasure does,
// so it refuses any database not on localhost.
//
//	go run ./tools/lobbyrecord -out ../shared/fixtures/lobby-room
//
// Environment: DATABASE_URL (the api's), WORKOS_COOKIE_PASSWORD (the
// api's), API (default http://localhost:8080).
//
// Three drafters take seats in a 12_ppr lobby: "you" (whose answers and
// socket frames are kept), jpk88 and mara. Each drafts our call on its own
// clock, by hand, as the frames bring its turn. Every answer is kept whole
// as the API sent it (the envelope), the room's board trimmed to its first
// 300 players and every player the recording names; the socket's frames
// are kept in the order "you" received them, with the commands it sent.
package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/db"
)

const (
	format     = "12_ppr"
	boardKeep  = 300
	teams      = 12
	recordedBy = "you"
)

var handles = []string{recordedBy, "jpk88", "mara"}

func main() {
	out := flag.String("out", "", "the fixture folder to write")
	flag.Parse()
	if *out == "" {
		fail(errors.New("-out is required"))
	}
	api := os.Getenv("API")
	if api == "" {
		api = "http://localhost:8080"
	}
	dsn := os.Getenv("DATABASE_URL")
	if u, err := url.Parse(dsn); err != nil || (u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1") {
		fail(errors.New("DATABASE_URL must be a local database: this tool writes sessions into it"))
	}
	password := os.Getenv("WORKOS_COOKIE_PASSWORD")
	if password == "" {
		fail(errors.New("WORKOS_COOKIE_PASSWORD is required"))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Minute)
	defer cancel()
	if err := record(ctx, api, dsn, password, *out); err != nil {
		fail(err)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "lobbyrecord:", err)
	os.Exit(1)
}

// drafter is one signed-in account, its cookies minted the way the sign-in
// callback mints them.
type drafter struct {
	handle  string
	session string
	csrf    string
	api     string
	seat    int
	room    string
	socket  string
}

func mint(ctx context.Context, dsn, password, handle, api string) (*drafter, error) {
	pool, err := db.Open(dsn)
	if err != nil {
		return nil, err
	}
	defer pool.Close()
	store := &auth.Store{Pool: pool}
	acct, err := store.UpsertAccount(ctx, auth.Identity{UserID: "lobbyrecord_" + handle, Email: handle + "@example.invalid"})
	if err != nil {
		return nil, err
	}
	if acct.Handle == nil {
		if _, err := store.SetHandle(ctx, acct.ID, handle); err != nil {
			return nil, err
		}
	}
	token := make([]byte, 32)
	_, _ = rand.Read(token)
	sum := sha256.Sum256(token)
	if err := store.CreateSession(ctx, acct.ID, sum[:], "", "lobbyrecord", time.Now()); err != nil {
		return nil, err
	}
	seal, err := auth.NewSealer(password, "commish session v1")
	if err != nil {
		return nil, err
	}
	csrf, err := auth.NewCSRFSigner(password)
	if err != nil {
		return nil, err
	}
	return &drafter{handle: handle, session: seal.Seal(token), csrf: csrf.Token(sum[:]), api: api}, nil
}

// call is one API request; it answers the whole envelope as the API sent it.
func (d *drafter) call(ctx context.Context, method, path string, body any) (json.RawMessage, int, error) {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, 0, err
		}
		reader = strings.NewReader(string(raw))
	}
	req, err := http.NewRequestWithContext(ctx, method, d.api+path, reader)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Cookie", auth.SessionCookie+"="+d.session)
	req.Header.Set(auth.CSRFHeader, d.csrf)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	if resp.StatusCode >= 300 {
		return raw, resp.StatusCode, fmt.Errorf("%s %s: %d %s", method, path, resp.StatusCode, raw)
	}
	return raw, resp.StatusCode, nil
}

// data is an envelope's data.
func data(envelope json.RawMessage, into any) error {
	var e struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(envelope, &e); err != nil {
		return err
	}
	return json.Unmarshal(e.Data, into)
}

type recorder struct {
	out    string
	mu     sync.Mutex
	frames []json.RawMessage
	names  map[string]bool
}

func (r *recorder) keep(name string, envelope json.RawMessage) error {
	var pretty any
	if err := json.Unmarshal(envelope, &pretty); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(pretty, "", "\t")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(r.out, name+".json"), append(raw, '\n'), 0o644)
}

func record(ctx context.Context, api, dsn, password, out string) error {
	if err := os.MkdirAll(out, 0o755); err != nil {
		return err
	}
	rec := &recorder{out: out, names: map[string]bool{}}
	people := make([]*drafter, 0, len(handles))
	for _, h := range handles {
		d, err := mint(ctx, dsn, password, h, api)
		if err != nil {
			return err
		}
		people = append(people, d)
	}
	you := people[0]
	for i, d := range people {
		envelope, _, err := d.call(ctx, http.MethodPost, "/lobbies/join", map[string]string{"format": format})
		if err != nil {
			return err
		}
		var seat struct {
			RoomID    string `json:"room_id"`
			Seat      int    `json:"seat"`
			SocketURL string `json:"socket_url"`
		}
		if err := data(envelope, &seat); err != nil {
			return err
		}
		d.seat, d.room, d.socket = seat.Seat, seat.RoomID, seat.SocketURL
		if i == 0 {
			if err := rec.keep("join", envelope); err != nil {
				return err
			}
		}
	}
	lobbies, _, err := you.call(ctx, http.MethodGet, "/lobbies", nil)
	if err != nil {
		return err
	}
	if err := rec.keep("lobbies", lobbies); err != nil {
		return err
	}
	filling, _, err := you.call(ctx, http.MethodGet, "/lobbies/"+you.room, nil)
	if err != nil {
		return err
	}
	done := make(chan error, len(people))
	for _, d := range people {
		go func(d *drafter) { done <- rec.draft(ctx, d, d == you) }(d)
	}
	for range people {
		if err := <-done; err != nil {
			return err
		}
	}
	complete, _, err := you.call(ctx, http.MethodGet, "/lobbies/"+you.room, nil)
	if err != nil {
		return err
	}
	for _, d := range people {
		report, _, err := d.call(ctx, http.MethodGet, "/lobbies/"+d.room+"/report", nil)
		if err != nil {
			return err
		}
		rec.namesIn(report)
		if err := rec.keep("report-"+d.handle, report); err != nil {
			return err
		}
	}
	for _, f := range rec.frames {
		rec.namesIn(f)
	}
	for name, envelope := range map[string]json.RawMessage{"room-filling": filling, "room-complete": complete} {
		trimmed, err := rec.trim(envelope)
		if err != nil {
			return err
		}
		if err := rec.keep(name, trimmed); err != nil {
			return err
		}
	}
	return rec.writeFrames()
}

// draft holds one drafter's socket from the hello to the room's end, drafting our call on each turn.
// The recorded drafter queues three players once the draft starts and keeps every frame.
func (r *recorder) draft(ctx context.Context, d *drafter, kept bool) error {
	conn, _, err := websocket.Dial(ctx, d.socket, &websocket.DialOptions{
		HTTPHeader: http.Header{"Cookie": {auth.SessionCookie + "=" + d.session}},
	})
	if err != nil {
		return fmt.Errorf("%s: dial: %w", d.handle, err)
	}
	defer func() { _ = conn.Close(websocket.StatusNormalClosure, "left the page") }()
	conn.SetReadLimit(8 << 20)
	send := func(cmd map[string]any) error {
		raw, _ := json.Marshal(cmd)
		if kept {
			r.mu.Lock()
			r.frames = append(r.frames, json.RawMessage(fmt.Sprintf(`{"client":%s}`, raw)))
			r.mu.Unlock()
		}
		return conn.Write(ctx, websocket.MessageText, raw)
	}
	if err := send(map[string]any{"type": "hello", "last_seq": 0}); err != nil {
		return err
	}
	pickNumber, drafting, queued, picked := 1, false, false, 0
	for {
		_, raw, err := conn.Read(ctx)
		if err != nil {
			return fmt.Errorf("%s: read: %w", d.handle, err)
		}
		if kept {
			r.mu.Lock()
			r.frames = append(r.frames, json.RawMessage(fmt.Sprintf(`{"server":%s}`, raw)))
			r.mu.Unlock()
		}
		var f struct {
			Type    string `json:"type"`
			Actions []struct {
				Kind    string `json:"kind"`
				Payload struct {
					Pick *struct {
						Pick int `json:"pick"`
					} `json:"pick"`
				} `json:"payload"`
			} `json:"actions"`
		}
		if err := json.Unmarshal(raw, &f); err != nil {
			return err
		}
		for _, a := range f.Actions {
			switch a.Kind {
			case "START_DRAFT":
				drafting = true
			case "MAKE_PICK", "TIMER_EXPIRE":
				if a.Payload.Pick != nil {
					pickNumber = a.Payload.Pick.Pick + 1
				}
			case "ROOM_COMPLETE", "ROOM_ABANDONED":
				return nil
			}
		}
		if !drafting {
			continue
		}
		if kept && !queued {
			queued = true
			if err := r.queue(ctx, d, send); err != nil {
				return err
			}
		}
		if seatAt(pickNumber) != d.seat || picked >= pickNumber {
			continue
		}
		picked = pickNumber
		card, _, err := d.call(ctx, http.MethodGet, "/lobbies/"+d.room+"/card", nil)
		if err != nil {
			return err
		}
		var c struct {
			Call string `json:"call"`
		}
		if err := data(card, &c); err != nil {
			return err
		}
		if kept {
			r.namesIn(card)
			if err := r.keep(fmt.Sprintf("card-%d", pickNumber), card); err != nil {
				return err
			}
		}
		if err := send(map[string]any{"type": "pick", "player_id": c.Call, "pick": pickNumber}); err != nil {
			return err
		}
	}
}

// queue sends the recorded drafter's queue: the three players after our first call.
func (r *recorder) queue(ctx context.Context, d *drafter, send func(map[string]any) error) error {
	card, _, err := d.call(ctx, http.MethodGet, "/lobbies/"+d.room+"/card", nil)
	if err != nil {
		return err
	}
	var c struct {
		Shortlist []struct {
			PlayerID string `json:"player_id"`
		} `json:"shortlist"`
	}
	if err := data(card, &c); err != nil {
		return err
	}
	ids := []string{}
	for i := len(c.Shortlist) - 1; i >= 0 && len(ids) < 3; i-- {
		ids = append(ids, c.Shortlist[i].PlayerID)
	}
	return send(map[string]any{"type": "queue", "player_ids": ids})
}

// seatAt is the seat on the clock at a pick of a snake draft.
func seatAt(pick int) int {
	round := (pick - 1) / teams
	i := (pick - 1) % teams
	if round%2 == 0 {
		return i + 1
	}
	return teams - i
}

// namesIn keeps every player id a recorded answer names, so the trimmed board holds them.
func (r *recorder) namesIn(raw json.RawMessage) {
	var walk func(any)
	walk = func(v any) {
		switch t := v.(type) {
		case map[string]any:
			for k, x := range t {
				if s, ok := x.(string); ok && (k == "player_id" || k == "call" || k == "playerId") {
					r.names[s] = true
				}
				if k == "still_there" {
					if m, ok := x.(map[string]any); ok {
						for id := range m {
							r.names[id] = true
						}
					}
				}
				if k == "player_ids" || k == "playerIds" {
					if l, ok := x.([]any); ok {
						for _, id := range l {
							if s, ok := id.(string); ok {
								r.names[s] = true
							}
						}
					}
				}
				walk(x)
			}
		case []any:
			for _, x := range t {
				walk(x)
			}
		}
	}
	var v any
	if json.Unmarshal(raw, &v) == nil {
		walk(v)
	}
}

// trim keeps a room's board to its first players and every player the recording names, in order.
func (r *recorder) trim(envelope json.RawMessage) (json.RawMessage, error) {
	var e map[string]any
	if err := json.Unmarshal(envelope, &e); err != nil {
		return nil, err
	}
	room, _ := e["data"].(map[string]any)
	board, _ := room["board"].(map[string]any)
	players, _ := board["players"].([]any)
	kept := make([]any, 0, boardKeep)
	for i, p := range players {
		id, _ := p.(map[string]any)["id"].(string)
		if i < boardKeep || r.names[id] {
			kept = append(kept, p)
		}
	}
	if board != nil {
		board["players"] = kept
	}
	return json.Marshal(e)
}

func (r *recorder) writeFrames() error {
	var steps []any
	for _, f := range r.frames {
		var v any
		if err := json.Unmarshal(f, &v); err != nil {
			return err
		}
		steps = append(steps, v)
	}
	raw, err := json.MarshalIndent(map[string]any{"recorded_by": recordedBy, "steps": steps}, "", "\t")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(r.out, "exchange.json"), append(raw, '\n'), 0o644)
}
