package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// frame is any message the room sends, with when it arrived.
type frame struct {
	Type    string                `json:"type"`
	Seq     int64                 `json:"seq"`
	Actions []apitypes.RoomAction `json:"actions"`
	Message string                `json:"message"`
	At      time.Time             `json:"-"`
}

// socket is one drafter's connection to a room.
type socket struct {
	conn   *websocket.Conn
	frames chan frame
}

// dial opens the room's socket, says hello with the last seq applied and
// waits for the welcome; took is the whole of it.
func dial(ctx context.Context, d *drafter, socketURL string, lastSeq int64) (*socket, frame, time.Duration, error) {
	began := time.Now()
	conn, _, err := websocket.Dial(ctx, socketURL, &websocket.DialOptions{HTTPHeader: http.Header{"Cookie": {d.cookie()}}})
	if err != nil {
		return nil, frame{}, 0, fmt.Errorf("dial %s: %w", socketURL, err)
	}
	conn.SetReadLimit(4 << 20)
	if err := wsjson.Write(ctx, conn, apitypes.RoomHello{Type: apitypes.RoomHelloTypeHello, LastSeq: lastSeq}); err != nil {
		return nil, frame{}, 0, err
	}
	var welcome frame
	if err := wsjson.Read(ctx, conn, &welcome); err != nil {
		return nil, frame{}, 0, err
	}
	took := time.Since(began)
	welcome.At = time.Now()
	s := &socket{conn: conn, frames: make(chan frame, 1024)}
	go s.read(ctx)
	return s, welcome, took, nil
}

func (s *socket) read(ctx context.Context) {
	defer close(s.frames)
	for {
		var f frame
		if err := wsjson.Read(ctx, s.conn, &f); err != nil {
			return
		}
		f.At = time.Now()
		s.frames <- f
	}
}

func (s *socket) send(ctx context.Context, cmd apitypes.RoomCommand) error {
	return wsjson.Write(ctx, s.conn, cmd)
}

func (s *socket) close() { _ = s.conn.Close(websocket.StatusGoingAway, "tab closed") }

// pickNote is a pick row's payload.pick.
type pickNote struct {
	Pick     int    `json:"pick"`
	Seat     int    `json:"seat"`
	PlayerID string `json:"player_id"`
	By       string `json:"by"`
}

func noteOf(a apitypes.RoomAction) (pickNote, bool) {
	raw, ok := a.Payload["pick"]
	if !ok {
		return pickNote{}, false
	}
	b, _ := json.Marshal(raw)
	var n pickNote
	return n, json.Unmarshal(b, &n) == nil
}

// snakeSeat is the seat on the clock at a pick.
func snakeSeat(pick, teams int) int {
	round := (pick - 1) / teams
	i := (pick - 1) % teams
	if round%2 == 0 {
		return i + 1
	}
	return teams - i
}

func socketURL(api, raw string) string {
	if strings.HasPrefix(raw, "ws") {
		return raw
	}
	return strings.Replace(api, "http", "ws", 1) + raw
}
