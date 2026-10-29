package notify

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// pushFixture is shared/fixtures/parity/push.json (shared/scripts/push-parity.ts,
// Lane 288): the payloads the apps route on, as each sender posts them.
type pushFixture struct {
	Cases []struct {
		Name    string            `json:"name"`
		Kind    Kind              `json:"kind"`
		Title   string            `json:"title"`
		Body    string            `json:"body"`
		Data    map[string]string `json:"data"`
		Starter *struct {
			PlayerID   string       `json:"player_id"`
			PlayerName string       `json:"player_name"`
			Change     StatusChange `json:"change"`
			Leagues    []struct {
				ID   uuid.UUID `json:"id"`
				Name string    `json:"name"`
			} `json:"leagues"`
			Capture int64 `json:"capture"`
		} `json:"starter"`
		FCM  map[string]any `json:"fcm"`
		APNs map[string]any `json:"apns"`
	} `json:"cases"`
}

// capture posts one message through a sender pointed at a test server and
// answers the JSON body the platform received.
func capture(t *testing.T, send func(origin string, client *http.Client, m Message) error, m Message) map[string]any {
	t.Helper()
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Errorf("body: %v", err)
		}
	}))
	defer srv.Close()
	if err := send(srv.URL, srv.Client(), m); err != nil {
		t.Fatal(err)
	}
	return body
}

// The apps' push fixture is what the API sends: each starter status case,
// built through the producer's row and posted by both senders, is the
// fixture's FCM message (the token aside) and APNs body, so a change to the
// payload fails here until the fixture, and the apps' routing, follow. The
// kinds without a producer yet are checked to be kinds.
func TestPushFixtureIsWhatTheAPISends(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "shared", "fixtures", "parity", "push.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture pushFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	_, pemKey := p8(t)
	starters := 0
	for _, c := range fixture.Cases {
		if !c.Kind.Valid() {
			t.Fatalf("%s: kind %q", c.Name, c.Kind)
		}
		if c.Starter == nil {
			continue
		}
		starters++
		in := make([]start, 0, len(c.Starter.Leagues))
		for _, l := range c.Starter.Leagues {
			in = append(in, start{
				league: leaguesync.LeagueStarters{LinkID: l.ID, LeagueName: l.Name},
				player: leaguesync.StartingPlayer{BoardID: c.Starter.PlayerID, Name: c.Starter.PlayerName},
			})
		}
		row := starterRow(uuid.New(), Change{PlayerID: c.Starter.PlayerID, Change: c.Starter.Change}, in,
			time.Unix(c.Starter.Capture, 0), time.Unix(c.Starter.Capture, 0))
		m := Message{Token: androidToken, Kind: row.Kind, Title: row.Title, Body: row.Body, Data: row.Data}

		fcmBody := capture(t, func(origin string, client *http.Client, m Message) error {
			return (&FCM{ProjectID: "trycommish", Client: client, Endpoint: origin}).Send(context.Background(), m)
		}, m)
		message, _ := fcmBody["message"].(map[string]any)
		delete(message, "token")
		if !reflect.DeepEqual(message, c.FCM) {
			t.Fatalf("%s: fcm\n got %v\nwant %v", c.Name, message, c.FCM)
		}

		m.Token = iosToken
		apnsBody := capture(t, func(origin string, client *http.Client, m Message) error {
			s, err := NewAPNs(APNsConfig{KeyID: "KEY123", TeamID: "TEAM45", Key: pemKey, Topic: "app.trycommish.ios", Origin: origin},
				client, &memoryTokens{}, time.Now)
			if err != nil {
				return err
			}
			return s.Send(context.Background(), m)
		}, m)
		if !reflect.DeepEqual(apnsBody, c.APNs) {
			t.Fatalf("%s: apns\n got %v\nwant %v", c.Name, apnsBody, c.APNs)
		}
	}
	if starters == 0 {
		t.Fatal("the fixture holds no starter status case")
	}
}
