package runs

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// The fixture run's reach, as the web's runReach counts it over the same
// files (web/src/lib/run/api-parity.test.ts holds the /run/manifest
// example to the web's count, and that example is this).
const fixtureReach = `{"format":"ppr-12","scoring":"PPR","through":"through week 5","complete":5,"partial":null}`

// manifestReach is a /run/manifest answer's reach, nil when it has none.
func manifestReach(t *testing.T, rec *httptest.ResponseRecorder) *apitypes.RunReach {
	t.Helper()
	var answer apitypes.RunManifestAnswer
	raw, err := json.Marshal(data(t, rec))
	if err != nil {
		t.Fatal(err)
	}
	strictly(t, "/run/manifest", raw, &answer)
	return answer.Reach
}

// waitFor waits for the reach pass's state to meet done; the pass runs in
// the background.
func waitFor(t *testing.T, s *server, what string, done func(reachMemo) bool) reachMemo {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		s.reader.mu.Lock()
		memo := s.reader.reach
		s.reader.mu.Unlock()
		if done(memo) {
			return memo
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("the reach pass never %s", what)
	return reachMemo{}
}

// landed waits for a first pass to land, its answer kept or its retry set.
func landed(t *testing.T, s *server) reachMemo {
	t.Helper()
	return waitFor(t, s, "landed", func(m reachMemo) bool { return m.answer != nil || !m.retryAt.IsZero() })
}

// reachOf asks the manifest, lets the pass it starts land with the
// reach, and is the reach the manifest then answers.
func reachOf(t *testing.T, s *server) apitypes.RunReach {
	t.Helper()
	data(t, s.get(t, "/run/manifest", nil))
	waitFor(t, s, "kept a reach", func(m reachMemo) bool { return m.answer != nil })
	got := manifestReach(t, s.get(t, "/run/manifest", nil))
	if got == nil {
		t.Fatal("the manifest answered no reach once the pass landed")
	}
	return *got
}

// lesser fails unless rec is the manifest without the reach: untagged,
// not to be kept.
func lesser(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if got := manifestReach(t, rec); got != nil {
		t.Fatalf("a reach was sent: %+v", got)
	}
	if rec.Header().Get("ETag") != "" || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("the lesser answer is tagged %q, %q", rec.Header().Get("ETag"), rec.Header().Get("Cache-Control"))
	}
}

// The fixture run's manifest carries its reach beside it, and its ETag is
// the manifest's as before.
func TestManifestCarriesTheFixtureReach(t *testing.T) {
	s := fixtureServer(t)
	reachOf(t, s)
	rec := s.get(t, "/run/manifest", nil)
	got := data(t, rec)
	sameJSON(t, "reach", decoded(t, got["reach"]), decoded(t, []byte(fixtureReach)))
	if tag := rec.Header().Get("ETag"); tag != `W/"`+fixtureRun+`/manifest.json"` {
		t.Fatalf("ETag %s; want the manifest's", tag)
	}
	if rec := s.get(t, "/run/manifest", http.Header{"If-None-Match": {rec.Header().Get("ETag")}}); rec.Code != http.StatusNotModified {
		t.Fatalf("If-None-Match: %d", rec.Code)
	}
	// The /run/manifest example is this reach, which the web's parity test
	// holds to the web's own count over the same run.
	spec, err := os.ReadFile("../../openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	example := "\n                  reach:\n                    format: ppr-12\n                    scoring: PPR\n" +
		"                    through: through week 5\n                    complete: 5\n                    partial: null\n"
	if !strings.Contains(string(spec), example) {
		t.Fatal("the /run/manifest example's reach is not the fixture run's")
	}
}

// week is one row of a made page's log.
type week struct {
	n        int
	status   string
	opponent string // "" names none
	unnamed  bool
}

// madePlayer is a page of a made run: his club, the run's through week,
// and the rows that differ from an upcoming week against "OPP".
type madePlayer struct {
	id, team string
	through  int
	rows     []week
}

func (p madePlayer) page() string {
	byWeek := map[int]week{}
	for _, row := range p.rows {
		byWeek[row.n] = row
	}
	rows := make([]string, 0, 18)
	for n := 1; n <= 18; n++ {
		row, ok := byWeek[n]
		if !ok {
			row = week{n: n, status: "upcoming", opponent: "OPP"}
		}
		opponent := "null"
		if row.opponent != "" {
			opponent = strconv.Quote(row.opponent)
		}
		unnamed := ""
		if row.unnamed {
			unnamed = `,"unnamedGame":true`
		}
		rows = append(rows, `{"week":`+strconv.Itoa(n)+`,"status":"`+row.status+`","opponent":`+opponent+unnamed+`}`)
	}
	return `{"id":"` + p.id + `","team":"` + p.team + `","season":{"format":"ppr-12","season":2026,"through":` +
		strconv.Itoa(p.through) + `,"weeks":18,"log":[` + strings.Join(rows, ",") + `]}}`
}

// madeRun is the fixture's manifest with the given pages, the schedule's
// slates and the held ids (each held page's refused document beside it).
func madeRun(t *testing.T, players []madePlayer, slates string, held []madePlayer) *server {
	t.Helper()
	at := "runs/" + fixtureRun + "/"
	files := map[string]string{at + "manifest.json": string(fixtureFile(t, "manifest.json"))}
	entries := []string{}
	for _, p := range slices.Concat(players, held) {
		entries = append(entries, `{"id":"`+p.id+`","orderBasis":"projection"}`)
		files[at+"players/"+p.id+".json"] = p.page()
	}
	files[at+"index.json"] = "[" + strings.Join(entries, ",") + "]"
	if len(held) > 0 {
		pages := []string{}
		for _, p := range held {
			pages = append(pages, `{"id":"`+p.id+`","refusal":"season","copy":null}`)
		}
		files[at+"held.json"] = `{"pages":[` + strings.Join(pages, ",") + `]}`
	}
	files[at+"schedule.json"] = `{"season":2026,"unit":"u","opponentBasis":"b","opponentValues":{},"slates":[` + slates + `]}`
	root := t.TempDir()
	writeRun(t, root, fixtureRun, files)
	return newServer(t, newDirObjects(os.DirFS(root)))
}

// slate is a club's slate of games, each "week|opponent|kickoff|state".
func slate(club string, games ...string) string {
	out := []string{}
	for _, g := range games {
		parts := strings.SplitN(g, "|", 4)
		out = append(out, `{"week":`+parts[0]+`,"opponent":"`+parts[1]+`","home":true,"kickoff":"`+parts[2]+`","state":"`+parts[3]+`"}`)
	}
	return `{"abbr":"` + club + `","rank":1,"method":"m","games":[` + strings.Join(out, ",") + `]}`
}

// Thursday night in the East, Friday in UTC: the day is the Eastern one.
const (
	thursday = "2026-10-16T00:15:00.000Z"
	sunday   = "2026-10-18T17:00:00.000Z"
)

func TestReachCases(t *testing.T) {
	slates := strings.Join([]string{
		slate("GB", "6|DAL|"+thursday+"|final"),
		slate("DAL", "6|GB|"+thursday+"|final"),
		slate("BUF", "6|LV|"+sunday+"|final"),
		slate("LV", "6|BUF|"+sunday+"|final"),
	}, ",")
	cases := []struct {
		name    string
		players []madePlayer
		held    []madePlayer
		want    apitypes.RunReach
	}{
		{
			name:    "before week 1",
			players: []madePlayer{{id: "a", team: "GB", through: 0}},
			want:    apitypes.RunReach{Format: "ppr-12", Scoring: "PPR", Through: "", Complete: 0},
		},
		{
			// GB's Thursday game is in his log; BUF's Sunday game is final by
			// its state alone, with no line behind it, so it is not counted.
			name: "mid-week with a Thursday game final",
			players: []madePlayer{
				{id: "a", team: "GB", through: 5, rows: []week{{n: 6, status: "played", opponent: "DAL"}}},
				{id: "b", team: "DAL", through: 5, rows: []week{{n: 6, status: "inactive", opponent: "GB"}}},
				{id: "c", team: "BUF", through: 5},
			},
			want: apitypes.RunReach{Format: "ppr-12", Scoring: "PPR", Through: "through week 5 and week 6's Thursday game",
				Complete: 5, Partial: &apitypes.RunReachPartial{Week: 6, Days: []string{"Thursday"}}},
		},
		{
			name: "two days, two games",
			players: []madePlayer{
				{id: "a", team: "GB", through: 5, rows: []week{{n: 6, status: "played", opponent: "DAL"}}},
				{id: "c", team: "BUF", through: 5, rows: []week{{n: 6, status: "played", opponent: "LV"}}},
			},
			want: apitypes.RunReach{Format: "ppr-12", Scoring: "PPR", Through: "through week 5 and week 6's Thursday and Sunday games",
				Complete: 5, Partial: &apitypes.RunReachPartial{Week: 6, Days: []string{"Thursday", "Sunday"}}},
		},
		{
			// An inactive week naming no opponent holds no game (a free
			// agent's), unless he played it.
			name: "a log naming no opponent",
			players: []madePlayer{
				{id: "a", team: "GB", through: 5, rows: []week{{n: 6, status: "inactive"}}},
			},
			want: apitypes.RunReach{Format: "ppr-12", Scoring: "PPR", Through: "through week 5", Complete: 5},
		},
		{
			// One he played that the run cannot name counts; his club's game
			// is not on the schedule, so the week is "part of week 6".
			name: "an unnamed game he played",
			players: []madePlayer{
				{id: "a", team: "NYJ", through: 5, rows: []week{{n: 6, status: "inactive", unnamed: true}}},
			},
			want: apitypes.RunReach{Format: "ppr-12", Scoring: "PPR", Through: "through week 5 and part of week 6",
				Complete: 5, Partial: &apitypes.RunReachPartial{Week: 6, Days: []string{}}},
		},
		{
			name:    "a held page excluded",
			players: []madePlayer{{id: "a", team: "BUF", through: 5}},
			held:    []madePlayer{{id: "h", team: "GB", through: 5, rows: []week{{n: 6, status: "played", opponent: "DAL"}}}},
			want:    apitypes.RunReach{Format: "ppr-12", Scoring: "PPR", Through: "through week 5", Complete: 5},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := madeRun(t, c.players, slates, c.held)
			got, err := json.Marshal(reachOf(t, s))
			if err != nil {
				t.Fatal(err)
			}
			want, err := json.Marshal(c.want)
			if err != nil {
				t.Fatal(err)
			}
			sameJSON(t, "reach", decoded(t, got), decoded(t, want))
			for _, h := range c.held {
				if n := s.objs.readsOf(fileKey(fixtureRun, "players/"+h.id+".json")); n != 0 {
					t.Fatalf("the held page %s was read %d times", h.id, n)
				}
			}
		})
	}
}

// The pass runs once per run: each page is read once however many ask.
func TestReachReadOncePerRun(t *testing.T) {
	s := madeRun(t, []madePlayer{{id: "a", team: "GB", through: 5}, {id: "b", team: "DAL", through: 5}}, slate("GB"), nil)
	for range 3 {
		reachOf(t, s)
	}
	s.advance(PointerTTL)
	reachOf(t, s)
	for _, id := range []string{"a", "b"} {
		if n := s.objs.readsOf(fileKey(fixtureRun, "players/"+id+".json")); n != 1 {
			t.Fatalf("page %s read %d times; want once", id, n)
		}
	}
}

// A manifest asked while the pass is slow answers at once without the
// reach, and with it, under the run's ETag, once the pass lands.
func TestManifestDoesNotWaitOnTheReach(t *testing.T) {
	s := madeRun(t, []madePlayer{{id: "a", team: "GB", through: 5}}, slate("GB"), nil)
	release := s.objs.holding(fileKey(fixtureRun, "players/a.json"))
	defer release()
	for range 3 {
		lesser(t, s.get(t, "/run/manifest", nil))
	}
	release()
	landed(t, s)
	rec := s.get(t, "/run/manifest", nil)
	if got := manifestReach(t, rec); got == nil || got.Through != "through week 5" {
		t.Fatalf("after the pass: %+v", got)
	}
	if tag := rec.Header().Get("ETag"); tag != `W/"`+fixtureRun+`/manifest.json"` {
		t.Fatalf("ETag %s", tag)
	}
	if n := s.objs.readsOf(fileKey(fixtureRun, "players/a.json")); n != 1 {
		t.Fatalf("the page was read %d times by one pass", n)
	}
}

// A request that hangs up does not end the pass it started: the next
// asker gets the reach.
func TestACancelledRequestLeavesThePass(t *testing.T) {
	s := madeRun(t, []madePlayer{{id: "a", team: "GB", through: 5}}, slate("GB"), nil)
	release := s.objs.holding(fileKey(fixtureRun, "players/a.json"))
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/run/manifest", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	s.mux.ServeHTTP(rec, req)
	cancel()
	lesser(t, rec)
	release()
	if got := landed(t, s); got.answer == nil {
		t.Fatalf("the pass was ended with its caller: %+v", got)
	}
	if r := manifestReach(t, s.get(t, "/run/manifest", nil)); r == nil {
		t.Fatal("the next asker got no reach")
	}
}

// A pass that runs out of time is never kept: the manifest answers
// without the reach and no pass runs again until the backoff ends, which
// doubles after each failure; then the reach lands.
func TestATimedOutPassBacksOff(t *testing.T) {
	s := madeRun(t, []madePlayer{{id: "a", team: "GB", through: 5}}, slate("GB"), nil)
	s.reader.reachTimeout = 20 * time.Millisecond
	page := fileKey(fixtureRun, "players/a.json")
	release := s.objs.holding(page)
	defer release()

	lesser(t, s.get(t, "/run/manifest", nil))
	if got := landed(t, s); got.answer != nil || got.backoff != firstReachBackoff {
		t.Fatalf("after a timeout: %+v", got)
	}
	lesser(t, s.get(t, "/run/manifest", nil))
	s.advance(firstReachBackoff - time.Second)
	lesser(t, s.get(t, "/run/manifest", nil))
	if n := s.objs.readsOf(page); n != 1 {
		t.Fatalf("the pass ran again within its backoff: %d reads", n)
	}

	s.advance(time.Second)
	lesser(t, s.get(t, "/run/manifest", nil))
	got := waitFor(t, s, "doubled its backoff", func(m reachMemo) bool { return m.backoff == 2*firstReachBackoff })
	if want := s.now().Add(2 * firstReachBackoff); !got.retryAt.Equal(want) || got.answer != nil {
		t.Fatalf("the second backoff: %+v; want a retry at %s", got, want)
	}

	release()
	s.advance(2 * firstReachBackoff)
	if r := reachOf(t, s); r.Through != "through week 5" {
		t.Fatalf("after the backoff: %+v", r)
	}
	if got := landed(t, s); got.backoff != 0 || !got.retryAt.IsZero() {
		t.Fatalf("a landed pass keeps a backoff: %+v", got)
	}
}

// A page that will not read is a failed pass: the manifest answers
// without the reach, and a client holding the run's answer keeps it (304).
func TestReachFailureKeepsTheManifest(t *testing.T) {
	s := madeRun(t, []madePlayer{{id: "a", team: "GB", through: 5}}, slate("GB"), nil)
	page := fileKey(fixtureRun, "players/a.json")
	s.objs.failing(page, errors.New("bucket down"))
	rec := s.get(t, "/run/manifest", nil)
	lesser(t, rec)
	if _, has := data(t, rec)["manifest"]; !has {
		t.Fatal("the manifest was not sent")
	}
	landed(t, s)
	tag := `W/"` + fixtureRun + `/manifest.json"`
	if rec := s.get(t, "/run/manifest", http.Header{"If-None-Match": {tag}}); rec.Code != http.StatusNotModified {
		t.Fatalf("a client holding the run's answer: %d", rec.Code)
	}
	s.objs.failing(page, nil)
	s.advance(firstReachBackoff)
	if r := reachOf(t, s); r.Through != "through week 5" {
		t.Fatalf("after the backoff: %+v", r)
	}
}

// A page whose block is scored apart from the first page's is a run the
// web's gate refuses: no reach rather than a wrong one.
func TestReachRefusesBlocksThatDisagree(t *testing.T) {
	s := madeRun(t, []madePlayer{{id: "a", team: "GB", through: 5}, {id: "b", team: "DAL", through: 4}}, slate("GB"), nil)
	lesser(t, s.get(t, "/run/manifest", nil))
	if got := landed(t, s); got.answer != nil {
		t.Fatalf("a reach over blocks that disagree: %+v", got)
	}
}
