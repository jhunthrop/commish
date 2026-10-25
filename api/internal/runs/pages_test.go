package runs

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// A player the fixture run gives a page (shared/fixtures/run, its index).
const fixturePlayer = "4047365"

// Lane 188's routes, each with the contract type its answer decodes into.
func fileRoutes() map[string]any {
	return map[string]any{
		"/run/players/" + fixturePlayer: &apitypes.RunPlayerAnswer{},
		"/run/record":                   &apitypes.RunRecordAnswer{},
		"/run/clubs":                    &apitypes.RunClubsAnswer{},
		"/run/schedule":                 &apitypes.RunScheduleAnswer{},
		"/run/held":                     &apitypes.RunHeldAnswer{},
	}
}

// strictly decodes raw into the contract type with no member left over.
func strictly(t *testing.T, what string, raw []byte, into any) {
	t.Helper()
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil {
		t.Fatalf("%s: %v", what, err)
	}
}

// Each answer is the fixture run's file as written: every player's page,
// the record, the clubs and the schedule whole, and no held pages.
func TestFileAnswersAreTheRunsFiles(t *testing.T) {
	s := fixtureServer(t)
	pages, _ := apart(decoded(t, fixtureFile(t, "index.json")).([]any))
	if len(pages) == 0 {
		t.Fatal("the fixture index has no page")
	}
	for _, entry := range pages {
		id := entry.(map[string]any)["id"].(string)
		got := data(t, s.get(t, "/run/players/"+id, nil))
		sameJSON(t, "player "+id, decoded(t, got["player"]), decoded(t, fixtureFile(t, "players/"+id+".json")))
	}
	for route, file := range map[string]string{"record": "record.json", "clubs": "clubs.json", "schedule": "schedule.json"} {
		got := data(t, s.get(t, "/run/"+route, nil))
		sameJSON(t, route, decoded(t, got[route]), decoded(t, fixtureFile(t, file)))
	}
	if held := data(t, s.get(t, "/run/held", nil)); string(held["held"]) != "null" {
		t.Fatalf("held %s; want null on a run that held none", held["held"])
	}
}

// The fixture's files decode into the generated types with no field left
// over, so the OpenAPI names every field the run writes.
func TestFileContractNamesEveryField(t *testing.T) {
	s := fixtureServer(t)
	for route, into := range fileRoutes() {
		raw, err := json.Marshal(data(t, s.get(t, route, nil)))
		if err != nil {
			t.Fatal(err)
		}
		strictly(t, route, raw, into)
	}
}

// heldRun is the fixture run with two held pages: one with an earlier
// run's copy beside it, one without.
const (
	heldWithCopy = "4429023"
	heldBare     = "4429795"
	copyRun      = "2026-10-20T12-ros"
)

func heldRun(t *testing.T, extra func(files map[string]string)) *server {
	t.Helper()
	root := t.TempDir()
	at := "runs/" + fixtureRun + "/"
	files := map[string]string{}
	for _, file := range []string{"manifest.json", "index.json", "players/" + fixturePlayer + ".json"} {
		files[at+file] = string(fixtureFile(t, file))
	}
	files[at+"held.json"] = `{"pages":[` +
		`{"id":"` + heldWithCopy + `","refusal":"season: the log has 17 weeks","copy":{"runId":"` + copyRun + `","runAt":"2026-10-20T12:00:00.000Z"}},` +
		`{"id":"` + heldBare + `","refusal":"capsule: a pull figure is not in the prose","copy":null}]}`
	files[at+"held/"+heldWithCopy+".json"] = string(fixtureFile(t, "players/"+heldWithCopy+".json"))
	// Tonight's refused document of a held page, which is never sent.
	files[at+"players/"+heldWithCopy+".json"] = `{"id":"` + heldWithCopy + `","broken":true}`
	if extra != nil {
		extra(files)
	}
	writeRun(t, root, fixtureRun, files)
	return newServer(t, newDirObjects(os.DirFS(root)))
}

// The held pages are named less what the reader said of them; a held page
// answers 404 on /run/players and its copy on /run/held/{id}; a held page
// with no copy answers 404 there too.
func TestHeldPages(t *testing.T) {
	s := heldRun(t, nil)
	rec := s.get(t, "/run/held", nil)
	if strings.Contains(rec.Body.String(), "refusal") || strings.Contains(rec.Body.String(), "17 weeks") {
		t.Fatalf("/run/held sent what the reader said: %s", rec.Body.String())
	}
	var held apitypes.RunHeldAnswer
	raw, _ := json.Marshal(data(t, rec))
	strictly(t, "/run/held", raw, &held)
	if held.Held == nil || len(held.Held.Pages) != 2 || held.Held.Pages[0].Copy == nil || held.Held.Pages[0].Copy.RunId != copyRun || held.Held.Pages[1].Copy != nil {
		t.Fatalf("held %+v", held.Held)
	}

	if rec := s.get(t, "/run/players/"+heldWithCopy, nil); rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "broken") {
		t.Fatalf("a held page tonight: %d %s", rec.Code, rec.Body.String())
	}
	got := data(t, s.get(t, "/run/held/"+heldWithCopy, nil))
	sameJSON(t, "copy", decoded(t, got["player"]), decoded(t, fixtureFile(t, "players/"+heldWithCopy+".json")))
	if tag := s.get(t, "/run/held/"+heldWithCopy, nil).Header().Get("ETag"); tag != `W/"`+fixtureRun+`/held/`+heldWithCopy+`.json"` {
		t.Fatalf("copy ETag %s", tag)
	}
	for _, path := range []string{"/run/held/" + heldBare, "/run/held/" + fixturePlayer, "/run/players/" + heldBare} {
		if rec := s.get(t, path, nil); rec.Code != http.StatusNotFound {
			t.Fatalf("%s: %d; want 404", path, rec.Code)
		}
	}
	data(t, s.get(t, "/run/players/"+fixturePlayer, nil))
}

// An id the run gives no page is a 404 envelope, never a 500, and the
// bucket is not asked for it; a malformed id is 400.
func TestPlayerRefusals(t *testing.T) {
	s := fixtureServer(t)
	for _, id := range []string{"0000000", "DST-SEA"} {
		rec := s.get(t, "/run/players/"+id, nil)
		var env struct {
			Ok    bool `json:"ok"`
			Error *struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil || rec.Code != http.StatusNotFound || env.Ok || env.Error == nil || env.Error.Code != "not_found" {
			t.Fatalf("%s: %d %s", id, rec.Code, rec.Body.String())
		}
		if n := s.objs.readsOf(fileKey(fixtureRun, "players/"+id+".json")); n != 0 {
			t.Fatalf("%s: the bucket was asked %d times", id, n)
		}
	}
	for _, id := range []string{"..%2Fmanifest", "a.b", "%20"} {
		if rec := s.get(t, "/run/players/"+id, nil); rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: %d; want 400", id, rec.Code)
		}
	}
}

// With no bucket configured each of these routes is 503, and each has a
// limit.
func TestFileRoutesUnconfigured(t *testing.T) {
	unconfigured := &Handler{Log: quietLog()}
	mux := http.NewServeMux()
	for _, rt := range unconfigured.Routes() {
		mux.HandleFunc(rt.Pattern(), rt.Handler)
		if rt.Limit.N <= 0 {
			t.Fatalf("%s has no rate limit", rt.Pattern())
		}
	}
	for _, path := range []string{"/run/players/" + fixturePlayer, "/run/held", "/run/held/" + heldWithCopy, "/run/record", "/run/clubs", "/run/schedule"} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s unconfigured: %d", path, rec.Code)
		}
	}
}

// A page that is another player's, or that does not read, is refused
// with a 503, never sent.
func TestPlayerPageOfAnotherRefused(t *testing.T) {
	s := heldRun(t, func(files map[string]string) {
		files["runs/"+fixtureRun+"/players/"+fixturePlayer+".json"] = string(fixtureFile(t, "players/"+heldBare+".json"))
	})
	if rec := s.get(t, "/run/players/"+fixturePlayer, nil); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("another's page: %d; want 503", rec.Code)
	}
}

// Each file is read once per run, and a 304 answers a matching ETag.
func TestFilesCachedAndNotModified(t *testing.T) {
	s := fixtureServer(t)
	for route := range fileRoutes() {
		first := s.get(t, route, nil)
		data(t, first)
		tag := first.Header().Get("ETag")
		if !strings.HasPrefix(tag, `W/"`+fixtureRun+`/`) {
			t.Fatalf("%s ETag %s", route, tag)
		}
		if rec := s.get(t, route, http.Header{"If-None-Match": {tag}}); rec.Code != http.StatusNotModified || rec.Body.Len() != 0 {
			t.Fatalf("%s If-None-Match: %d", route, rec.Code)
		}
	}
	for _, file := range []string{"players/" + fixturePlayer + ".json", "record.json", "clubs.json", "schedule.json", "held.json", "index.json"} {
		if n := s.objs.readsOf(fileKey(fixtureRun, file)); n != 1 {
			t.Fatalf("%s read %d times; want once", file, n)
		}
	}
}

// A member the contract does not name, at any depth of a page, the
// record, the clubs, the schedule or the held pages, never reaches the
// wire, and every answer still decodes strictly.
func TestFilesDropWhatTheContractDoesNotName(t *testing.T) {
	const extra = "internalNote"
	add := func(v any) any { return mustObject(t, withExtra(t, mustJSON(t, v), extra)) }

	player := decoded(t, fixtureFile(t, "players/"+fixturePlayer+".json")).(map[string]any)
	formats := player["formats"].(map[string]any)
	for id, f := range formats {
		formats[id] = add(f)
	}
	player["capsule"] = add(player["capsule"])
	capsule := player["capsule"].(map[string]any)
	pulls := capsule["pulls"].([]any)
	if len(pulls) > 0 {
		pulls[0] = add(pulls[0])
	}
	season := player["season"].(map[string]any)
	season["totals"] = add(season["totals"])
	log := season["log"].([]any)
	log[0] = add(log[0])
	player["weekRead"] = add(map[string]any{"week": 8, "body": "Start him.", "caption": "Written Fri 9:00 pm Central, for week 8",
		"status": nil, "call": "start", "writtenAt": "2026-10-23T02:00:00.000Z", "factsAt": nil})
	player["priorSeasons"] = []any{add(map[string]any{"season": 2025, "games": 1, "pointsPerGame": 1.0, "totals": season["totals"]})}
	player["lastGameClub"] = add(map[string]any{"club": "NYJ", "week": 6})
	player = add(player).(map[string]any)

	record := decoded(t, fixtureFile(t, "record.json")).(map[string]any)
	record["statistic"] = add(record["statistic"])
	weeks := record["weeks"].([]any)
	week := add(weeks[0]).(map[string]any)
	lines := week["lines"].([]any)
	line := add(lines[0]).(map[string]any)
	line["ours"] = add(line["ours"])
	lines[0] = line
	weeks[0] = week
	record = add(record).(map[string]any)

	clubs := decoded(t, fixtureFile(t, "clubs.json")).([]any)
	clubs[0] = add(clubs[0])

	schedule := decoded(t, fixtureFile(t, "schedule.json")).(map[string]any)
	slates := schedule["slates"].([]any)
	slate := add(slates[0]).(map[string]any)
	games := slate["games"].([]any)
	games[0] = add(games[0])
	slate["window"] = add(slate["window"])
	slates[0] = slate
	schedule = add(schedule).(map[string]any)

	s := heldRun(t, func(files map[string]string) {
		at := "runs/" + fixtureRun + "/"
		files[at+"players/"+fixturePlayer+".json"] = mustJSON(t, player)
		files[at+"record.json"] = mustJSON(t, record)
		files[at+"clubs.json"] = mustJSON(t, clubs)
		files[at+"schedule.json"] = mustJSON(t, schedule)
		held := decoded(t, []byte(files[at+"held.json"])).(map[string]any)
		page := add(held["pages"].([]any)[0]).(map[string]any)
		page["copy"] = add(page["copy"])
		held["pages"].([]any)[0] = page
		files[at+"held.json"] = mustJSON(t, add(held))
	})
	routes := fileRoutes()
	routes["/run/held/"+heldWithCopy] = &apitypes.RunPlayerAnswer{}
	for route, into := range routes {
		rec := s.get(t, route, nil)
		if strings.Contains(rec.Body.String(), extra) {
			t.Fatalf("%s sent a member the contract does not name: %s", route, rec.Body.String())
		}
		raw, err := json.Marshal(data(t, rec))
		if err != nil {
			t.Fatal(err)
		}
		strictly(t, route, raw, reflect.New(reflect.TypeOf(into).Elem()).Interface())
	}
}
