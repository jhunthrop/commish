// Command roommeasure takes the rooms lane's measurements against a local
// api and room service (docs/design/2026-10-12-mock-room-rethink.md, "Where
// it runs": measurement before build). It mints sessions straight into the
// database it is pointed at, so it refuses any database not on localhost.
//
//	go run ./tools/roommeasure solo   [-mocks 20]
//	go run ./tools/roommeasure lobby  [-format 12_ppr] [-people 12]
//	go run ./tools/roommeasure fill   [-format 10_ppr]
//
// Environment: DATABASE_URL (the api's), WORKOS_COOKIE_PASSWORD (the api's),
// API (default http://localhost:8080).
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"
)

func main() {
	if len(os.Args) < 2 {
		fail(errors.New("usage: roommeasure solo|lobby|fill [flags]"))
	}
	env, err := loadEnv()
	if err != nil {
		fail(err)
	}
	ctx := context.Background()
	fs := flag.NewFlagSet(os.Args[1], flag.ExitOnError)
	switch os.Args[1] {
	case "solo":
		mocks := fs.Int("mocks", 20, "mocks to draft start to finish")
		anon := fs.Bool("anon", false, "draft signed out, under an anonymous browser token")
		_ = fs.Parse(os.Args[2:])
		err = measureSolo(ctx, env, *mocks, *anon)
	case "lobby":
		format := fs.String("format", "12_ppr", "the lobby format")
		people := fs.Int("people", 12, "drafters to seat")
		_ = fs.Parse(os.Args[2:])
		err = measureLobby(ctx, env, *format, *people)
	case "session":
		// A signed-in session for a page tool (web/scripts/room-shots.ts):
		// prints the session cookie, the CSRF token and the account id.
		handle := fs.String("handle", "shots", "the account's handle")
		_ = fs.Parse(os.Args[2:])
		var d *drafter
		if d, err = mint(ctx, env, *handle); err == nil {
			fmt.Println(d.Session, d.CSRF, d.ID)
		}
	case "fill":
		format := fs.String("format", "10_ppr", "the lobby format")
		_ = fs.Parse(os.Args[2:])
		err = measureLobby(ctx, env, *format, 1)
	default:
		err = fmt.Errorf("unknown measurement %q", os.Args[1])
	}
	if err != nil {
		fail(err)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "roommeasure:", err)
	os.Exit(1)
}

type environment struct {
	DatabaseURL string
	Password    string
	API         string
}

func loadEnv() (environment, error) {
	e := environment{DatabaseURL: os.Getenv("DATABASE_URL"), Password: os.Getenv("WORKOS_COOKIE_PASSWORD"), API: os.Getenv("API")}
	if e.API == "" {
		e.API = "http://localhost:8080"
	}
	u, err := url.Parse(e.DatabaseURL)
	if err != nil || (u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1") {
		return e, errors.New("DATABASE_URL must be a local database: this tool writes sessions into it")
	}
	if e.Password == "" {
		return e, errors.New("WORKOS_COOKIE_PASSWORD is required")
	}
	return e, nil
}

// summary is a sample's percentiles in milliseconds.
type summary struct {
	n             int
	p50, p90, max float64
}

func summarize(samples []time.Duration) summary {
	if len(samples) == 0 {
		return summary{}
	}
	sorted := append([]time.Duration(nil), samples...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	at := func(q float64) float64 {
		i := int(q*float64(len(sorted))+0.5) - 1
		return float64(sorted[min(max(i, 0), len(sorted)-1)].Microseconds()) / 1000
	}
	return summary{n: len(sorted), p50: at(0.5), p90: at(0.9), max: float64(sorted[len(sorted)-1].Microseconds()) / 1000}
}

func (s summary) String() string {
	return fmt.Sprintf("n=%d p50=%.1f ms p90=%.1f ms max=%.1f ms", s.n, s.p50, s.p90, s.max)
}

func line(label string, s fmt.Stringer) { fmt.Printf("%-44s %s\n", label, s) }

func handleFor(prefix string, i int) string {
	return strings.ToLower(fmt.Sprintf("%s%d_%d", prefix, i, time.Now().UnixNano()%100000))
}
