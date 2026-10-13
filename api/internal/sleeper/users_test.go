package sleeper

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"
)

// A member's display name is shown to the whole league: control and
// format characters go, it is trimmed and cut at 30 runes, and markup is
// kept as plain text (the web renders it as text, never as HTML).
func TestCleanName(t *testing.T) {
	long := strings.Repeat("é", 31)
	cases := []struct{ in, want string }{
		{"  muttdog  ", "muttdog"},
		{"jj\x00zach\tariason\n", "jjzachariason"},
		{"evil‮eman", "evileman"},
		{"zero​width", "zerowidth"},
		{"<script>alert(1)</script>", "<script>alert(1)</script>"},
		{long, strings.Repeat("é", 30)},
		{"‮", ""},
	}
	for _, c := range cases {
		got := cleanName(c.in)
		if got != c.want {
			t.Errorf("cleanName(%q) = %q, want %q", c.in, got, c.want)
		}
		if utf8.RuneCountInString(got) > maxDisplayName {
			t.Errorf("cleanName(%q) is %d runes", c.in, utf8.RuneCountInString(got))
		}
	}
}

func usersServer(t *testing.T, users []wireUser) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(users)
	}))
	t.Cleanup(srv.Close)
	return &Client{HTTP: srv.Client(), BaseURL: srv.URL}
}

// A league answer is bounded and checked: members with no usable id or
// name are left out, and more members than any league seats is refused.
func TestLeagueUsers(t *testing.T) {
	c := usersServer(t, []wireUser{
		{UserID: "88765090903769088", DisplayName: " muttdog "},
		{UserID: "not-an-id", DisplayName: "nobody"},
		{UserID: "723227693008637952", DisplayName: "‮"},
	})
	got, err := c.LeagueUsers(context.Background(), "1382163311038038016")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].DisplayName != "muttdog" {
		t.Fatalf("users %+v, want only muttdog", got)
	}

	many := make([]wireUser, maxUsers+1)
	for i := range many {
		many[i] = wireUser{UserID: fmt.Sprint(1000 + i), DisplayName: "x"}
	}
	if _, err := usersServer(t, many).LeagueUsers(context.Background(), "1"); !errors.Is(err, ErrMalformed) {
		t.Fatalf("%d users: %v, want ErrMalformed", len(many), err)
	}
	if _, err := c.LeagueUsers(context.Background(), "../draft/1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("a path for an id: %v, want ErrNotFound", err)
	}
}
