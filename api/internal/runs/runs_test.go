package runs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// The shared fixture run (shared/fixtures/run, shared/scripts/export-run.ts):
// the web's contract run as the bucket holds it.
const (
	fixtureDir = "../../../shared/fixtures/run"
	fixtureRun = "2026-10-21T12-ros"
	pprFormat  = "ppr-12"
)

var clock = time.Date(2026, 10, 21, 13, 0, 0, 0, time.UTC)

// dirObjects is a bucket on disk, counting each key's reads.
type dirObjects struct {
	fsys  fs.FS
	mu    sync.Mutex
	reads map[string]int
	// fail answers every read of a key with an error.
	fail map[string]error
}

func newDirObjects(fsys fs.FS) *dirObjects {
	return &dirObjects{fsys: fsys, reads: map[string]int{}, fail: map[string]error{}}
}

func (d *dirObjects) Get(_ context.Context, key string) ([]byte, error) {
	d.mu.Lock()
	d.reads[key]++
	failure := d.fail[key]
	d.mu.Unlock()
	if failure != nil {
		return nil, failure
	}
	b, err := fs.ReadFile(d.fsys, key)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, ErrNotFound
	}
	return b, err
}

func (d *dirObjects) readsOf(key string) int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.reads[key]
}

func quietLog() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

type server struct {
	mux  *http.ServeMux
	now  *time.Time
	objs *dirObjects
}

func newServer(t *testing.T, objs *dirObjects) *server {
	t.Helper()
	now := clock
	s := &server{mux: http.NewServeMux(), now: &now, objs: objs}
	h := &Handler{Reader: NewReader(objs, func() time.Time { return *s.now }, quietLog()), Log: quietLog()}
	for _, rt := range h.Routes() {
		s.mux.HandleFunc(rt.Pattern(), rt.Handler)
	}
	return s
}

func fixtureServer(t *testing.T) *server {
	return newServer(t, newDirObjects(os.DirFS(fixtureDir)))
}

func (s *server) get(t *testing.T, path string, header http.Header) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	for k, v := range header {
		req.Header[k] = v
	}
	rec := httptest.NewRecorder()
	s.mux.ServeHTTP(rec, req)
	return rec
}

// data is a 200's envelope data, its members as sent.
func data(t *testing.T, rec *httptest.ResponseRecorder) map[string]json.RawMessage {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var env struct {
		Ok   bool                       `json:"ok"`
		Data map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil || !env.Ok {
		t.Fatalf("envelope %s: %v", rec.Body.String(), err)
	}
	var runID string
	if err := json.Unmarshal(env.Data["run_id"], &runID); err != nil || runID != fixtureRun {
		t.Fatalf("run_id %s; want %s", env.Data["run_id"], fixtureRun)
	}
	return env.Data
}

func fixtureFile(t *testing.T, file string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(fixtureDir, "runs", fixtureRun, file))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// decoded is JSON as values, numbers exactly as written.
func decoded(t *testing.T, raw []byte) any {
	t.Helper()
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		t.Fatalf("%s: %v", raw, err)
	}
	return v
}

func sameJSON(t *testing.T, what string, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		g, _ := json.Marshal(got)
		w, _ := json.Marshal(want)
		t.Fatalf("%s:\n got %s\nwant %s", what, g, w)
	}
}

// only is a decoded object with only the named keys, each of which it
// must hold.
func only(t *testing.T, raw []byte, keys []string) map[string]any {
	t.Helper()
	obj, ok := decoded(t, raw).(map[string]any)
	if !ok {
		t.Fatalf("%s is not an object", raw)
	}
	kept := map[string]any{}
	for _, key := range keys {
		value, had := obj[key]
		if !had {
			t.Fatalf("the fixture has no %q", key)
		}
		kept[key] = value
	}
	if len(kept) == len(obj) {
		t.Fatalf("the fixture holds nothing the answer leaves out: %v", keys)
	}
	return kept
}

// apart is a list's ranked members and its kickers and defenses, the
// way the web's run/market.ts splits them.
func apart(list []any) (ranked, market []any) {
	ranked, market = []any{}, []any{}
	for _, m := range list {
		if m.(map[string]any)["orderBasis"] == marketBasis {
			market = append(market, m)
		} else {
			ranked = append(ranked, m)
		}
	}
	return ranked, market
}

// Every /run answer is the fixture run's file as written: the manifest
// and the designations less their provenance, the board and the index
// with their kickers and defenses apart, the ADP whole.
func TestAnswersAreTheRunsFiles(t *testing.T) {
	s := fixtureServer(t)

	manifest := data(t, s.get(t, "/run/manifest", nil))
	sameJSON(t, "manifest", decoded(t, manifest["manifest"]), only(t, fixtureFile(t, "manifest.json"), jsonNames(reflect.TypeFor[apitypes.RunManifest]())))

	board := data(t, s.get(t, "/run/boards/"+pprFormat, nil))
	file := decoded(t, fixtureFile(t, "boards/"+pprFormat+".json")).(map[string]any)
	rows, market := apart(file["rows"].([]any))
	sameJSON(t, "board format", decoded(t, board["format"]), file["format"])
	sameJSON(t, "board rows", decoded(t, board["rows"]), rows)
	sameJSON(t, "board market", decoded(t, board["market"]), market)
	if len(rows) == 0 {
		t.Fatal("the fixture board has no ranked row")
	}

	index := data(t, s.get(t, "/run/index", nil))
	pages, marketEntries := apart(decoded(t, fixtureFile(t, "index.json")).([]any))
	sameJSON(t, "index pages", decoded(t, index["pages"]), pages)
	sameJSON(t, "index market", decoded(t, index["market"]), marketEntries)

	adp := data(t, s.get(t, "/run/adp", nil))
	sameJSON(t, "adp", decoded(t, adp["adp"]), decoded(t, fixtureFile(t, "adp.json")))

	designations := data(t, s.get(t, "/run/designations", nil))
	sameJSON(t, "designations", decoded(t, designations["designations"]),
		only(t, fixtureFile(t, "designations.json"), jsonNames(reflect.TypeFor[apitypes.RunDesignations]())))
}

// The OpenAPI's schemas name every field the run writes: each file
// decodes into the generated type with no field left over.
func TestTheContractNamesEveryField(t *testing.T) {
	strict := func(name string, raw []byte, into any) {
		t.Helper()
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.DisallowUnknownFields()
		if err := dec.Decode(into); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	s := fixtureServer(t)
	answers := map[string]any{
		"/run/manifest":            &apitypes.RunManifestAnswer{},
		"/run/boards/" + pprFormat: &apitypes.RunBoardAnswer{},
		"/run/index":               &apitypes.RunIndexAnswer{},
		"/run/adp":                 &apitypes.RunAdpAnswer{},
		"/run/designations":        &apitypes.RunDesignationsAnswer{},
	}
	for route, into := range answers {
		raw, err := json.Marshal(data(t, s.get(t, route, nil)))
		if err != nil {
			t.Fatal(err)
		}
		strict(route, raw, into)
	}
	board := answers["/run/boards/"+pprFormat].(*apitypes.RunBoardAnswer)
	if board.Rows[0].Tier < 1 || board.Rows[0].OurRank < 1 || board.Rows[0].VorRound < 1 {
		t.Fatalf("the board's first row has no tier, place or round: %+v", board.Rows[0])
	}
}

// ETag names the run and the file, weak (the gzip and the plain body
// share it); a matching If-None-Match, weak, strong or listed, answers
// 304 with no body; any other the file.
func TestETagAndNotModified(t *testing.T) {
	s := fixtureServer(t)
	first := s.get(t, "/run/boards/"+pprFormat, nil)
	tag := first.Header().Get("ETag")
	if want := `W/"` + fixtureRun + `/boards/` + pprFormat + `.json"`; tag != want {
		t.Fatalf("ETag %s; want %s", tag, want)
	}
	if got := first.Header().Get("Cache-Control"); got != "public, max-age=60" {
		t.Fatalf("Cache-Control %q", got)
	}
	for _, header := range []string{tag, strings.TrimPrefix(tag, "W/"), `"other", ` + tag, "*"} {
		rec := s.get(t, "/run/boards/"+pprFormat, http.Header{"If-None-Match": {header}})
		if rec.Code != http.StatusNotModified || rec.Body.Len() != 0 || rec.Header().Get("ETag") != tag {
			t.Fatalf("If-None-Match %s: %d %q", header, rec.Code, rec.Body.String())
		}
	}
	stale := s.get(t, "/run/boards/"+pprFormat, http.Header{"If-None-Match": {`"2026-10-20T12-ros/boards/ppr-12.json"`}})
	data(t, stale)
	other := s.get(t, "/run/index", http.Header{"If-None-Match": {tag}})
	data(t, other)
}

// Each file is read once per run; the pointer once per PointerTTL; an
// hourly file again after it, its ETag following what it holds.
func TestReadsCachedPerRun(t *testing.T) {
	s := fixtureServer(t)
	pointer := "runs/latest.json"
	board := fileKey(fixtureRun, "boards/"+pprFormat+".json")
	designations := fileKey(fixtureRun, designationsFile.path)
	for range 3 {
		data(t, s.get(t, "/run/boards/"+pprFormat, nil))
		data(t, s.get(t, "/run/designations", nil))
	}
	if s.objs.readsOf(pointer) != 1 || s.objs.readsOf(board) != 1 || s.objs.readsOf(designations) != 1 {
		t.Fatalf("reads: pointer %d board %d designations %d; want one each",
			s.objs.readsOf(pointer), s.objs.readsOf(board), s.objs.readsOf(designations))
	}
	*s.now = s.now.Add(PointerTTL)
	data(t, s.get(t, "/run/boards/"+pprFormat, nil))
	data(t, s.get(t, "/run/designations", nil))
	if s.objs.readsOf(pointer) != 2 || s.objs.readsOf(board) != 1 || s.objs.readsOf(designations) != 2 {
		t.Fatalf("after the TTL: pointer %d board %d designations %d; want 2, 1, 2",
			s.objs.readsOf(pointer), s.objs.readsOf(board), s.objs.readsOf(designations))
	}
	tag := s.get(t, "/run/designations", nil).Header().Get("ETag")
	if want := `W/"` + fixtureRun + `/designations.json@`; len(tag) <= len(want) || tag[:len(want)] != want {
		t.Fatalf("an hourly file's ETag %s; want the run, the file and a digest", tag)
	}
}

// writeRun lays a bucket on disk: the pointer and each file of a run.
func writeRun(t *testing.T, root, pointer string, files map[string]string) {
	t.Helper()
	put := func(key, body string) {
		p := filepath.Join(root, filepath.FromSlash(key))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	put("runs/latest.json", `{"runId":"`+pointer+`"}`)
	for key, body := range files {
		put(key, body)
	}
}

// A run is read only once its manifest is there and says it is that run;
// when the pointer moves on, the next run's files are read, and when it
// cannot be read the published run stays.
func TestPublishedRun(t *testing.T) {
	t.Run("a pointer at a run with no manifest is refused", func(t *testing.T) {
		root := t.TempDir()
		writeRun(t, root, "2026-10-22T05", nil)
		rec := newServer(t, newDirObjects(os.DirFS(root))).get(t, "/run/manifest", nil)
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("status %d; want 503", rec.Code)
		}
	})
	t.Run("a manifest naming another run is refused", func(t *testing.T) {
		root := t.TempDir()
		writeRun(t, root, "2026-10-22T05", map[string]string{"runs/2026-10-22T05/manifest.json": `{"runId":"2026-10-21T05"}`})
		if rec := newServer(t, newDirObjects(os.DirFS(root))).get(t, "/run/manifest", nil); rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("status %d; want 503", rec.Code)
		}
	})
	t.Run("a pointer that is not a run id is refused", func(t *testing.T) {
		root := t.TempDir()
		writeRun(t, root, "../exports", nil)
		if rec := newServer(t, newDirObjects(os.DirFS(root))).get(t, "/run/manifest", nil); rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("status %d; want 503", rec.Code)
		}
	})
	t.Run("the pointer moves and the next run is read; a failed read keeps the run", func(t *testing.T) {
		root := t.TempDir()
		manifest := func(id string) string { return `{"runId":"` + id + `","formats":[{"id":"ppr-12"}]}` }
		writeRun(t, root, "2026-10-21T05", map[string]string{
			"runs/2026-10-21T05/manifest.json": manifest("2026-10-21T05"),
			"runs/2026-10-22T05/manifest.json": manifest("2026-10-22T05"),
		})
		objs := newDirObjects(os.DirFS(root))
		s := newServer(t, objs)
		runOf := func() string {
			var id string
			_ = json.Unmarshal(s.dataOf(t, "/run/manifest")["run_id"], &id)
			return id
		}
		if got := runOf(); got != "2026-10-21T05" {
			t.Fatalf("run %s", got)
		}
		writeRun(t, root, "2026-10-22T05", nil)
		*s.now = s.now.Add(PointerTTL)
		if got := runOf(); got != "2026-10-22T05" {
			t.Fatalf("after the pointer moved: run %s", got)
		}
		objs.fail["runs/latest.json"] = errors.New("r2 is down")
		*s.now = s.now.Add(PointerTTL)
		if got := runOf(); got != "2026-10-22T05" {
			t.Fatalf("with the pointer unread: run %s; want the published run kept", got)
		}
	})
}

// dataOf is a 200's data from any run.
func (s *server) dataOf(t *testing.T, path string) map[string]json.RawMessage {
	t.Helper()
	rec := s.get(t, path, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("%s: %d %s", path, rec.Code, rec.Body.String())
	}
	var env struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	return env.Data
}

// A run without a capture answers designations null, as the web reads it.
func TestDesignationsAbsent(t *testing.T) {
	root := t.TempDir()
	writeRun(t, root, fixtureRun, map[string]string{"runs/" + fixtureRun + "/manifest.json": string(fixtureFile(t, "manifest.json"))})
	got := newServer(t, newDirObjects(os.DirFS(root))).dataOf(t, "/run/designations")
	if string(got["designations"]) != "null" {
		t.Fatalf("designations %s; want null", got["designations"])
	}
}

// A format the run does not carry is 404, a malformed one 400, and with
// no bucket configured every route is 503.
func TestRefusals(t *testing.T) {
	s := fixtureServer(t)
	if rec := s.get(t, "/run/boards/superflex-10", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("an uncarried format: %d", rec.Code)
	}
	if rec := s.get(t, "/run/boards/PPR", nil); rec.Code != http.StatusBadRequest {
		t.Fatalf("a malformed format: %d", rec.Code)
	}
	unconfigured := &Handler{Log: quietLog()}
	mux := http.NewServeMux()
	for _, rt := range unconfigured.Routes() {
		mux.HandleFunc(rt.Pattern(), rt.Handler)
		if rt.Limit.N <= 0 {
			t.Fatalf("%s has no rate limit", rt.Pattern())
		}
	}
	for _, path := range []string{"/run/manifest", "/run/boards/" + pprFormat, "/run/index", "/run/adp", "/run/designations"} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s unconfigured: %d", path, rec.Code)
		}
	}
}

// A board file that says it is another format is refused, not served.
func TestBoardOfAnotherFormatRefused(t *testing.T) {
	root := t.TempDir()
	writeRun(t, root, fixtureRun, map[string]string{
		"runs/" + fixtureRun + "/manifest.json":      string(fixtureFile(t, "manifest.json")),
		"runs/" + fixtureRun + "/boards/ppr-12.json": `{"format":"half-ppr-12","rows":[]}`,
	})
	if rec := newServer(t, newDirObjects(os.DirFS(root))).get(t, "/run/boards/ppr-12", nil); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d; want 503", rec.Code)
	}
}

// jsonNames is every member a contract type names.
func jsonNames(t reflect.Type) []string {
	names := make([]string, 0, t.NumField())
	for i := range t.NumField() {
		name, _, _ := strings.Cut(t.Field(i).Tag.Get("json"), ",")
		names = append(names, name)
	}
	return names
}

// withExtra is a JSON object with one more member, the way the nightly
// adds a field the contract does not name yet.
func withExtra(t *testing.T, raw string, key string) string {
	t.Helper()
	var obj map[string]any
	if err := json.Unmarshal([]byte(raw), &obj); err != nil {
		t.Fatal(err)
	}
	obj[key] = "never on the wire"
	b, err := json.Marshal(obj)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// A member the contract does not name, at any depth (a manifest's format,
// a board row, a kicker's row, an index entry's season, an ADP source, a
// designation), never reaches the wire, and every answer still decodes
// strictly into its contract type.
func TestTheContractNamesEveryFieldAndDropsTheRest(t *testing.T) {
	const extra = "internalNote"
	root := t.TempDir()
	manifest := decoded(t, fixtureFile(t, "manifest.json")).(map[string]any)
	formats := manifest["formats"].([]any)
	formats[0] = mustObject(t, withExtra(t, mustJSON(t, formats[0]), extra))
	board := decoded(t, fixtureFile(t, "boards/"+pprFormat+".json")).(map[string]any)
	rows := board["rows"].([]any)
	rows[0] = mustObject(t, withExtra(t, mustJSON(t, rows[0]), extra))
	market := `{"id":"DST-SEA","slug":"seattle-seahawks","name":"Seattle Seahawks","position":"DST","positionRank":1,"team":"SEA",` +
		`"headshot":null,"orderBasis":"market","ourRank":401,"adp":81,"vorRound":null,"projected":null,"vor":null,` +
		`"expectedGames":null,"floor":null,"median":null,"ceiling":null,"tier":null}`
	board["rows"] = append(rows, mustObject(t, withExtra(t, market, extra)))
	index := decoded(t, fixtureFile(t, "index.json")).([]any)
	entry := index[0].(map[string]any)
	entry["season"] = mustObject(t, withExtra(t, mustJSON(t, entry["season"]), extra))
	adp := decoded(t, fixtureFile(t, "adp.json")).(map[string]any)
	sources := adp["sources"].([]any)
	sources[0] = mustObject(t, withExtra(t, mustJSON(t, sources[0]), extra))
	designations := decoded(t, fixtureFile(t, "designations.json")).(map[string]any)
	for id, status := range designations["players"].(map[string]any) {
		designations["players"].(map[string]any)[id] = mustObject(t, withExtra(t, mustJSON(t, status), extra))
	}
	at := "runs/" + fixtureRun + "/"
	writeRun(t, root, fixtureRun, map[string]string{
		at + "manifest.json":                 mustJSON(t, manifest),
		at + "boards/" + pprFormat + ".json": mustJSON(t, board),
		at + "index.json":                    mustJSON(t, index),
		at + "adp.json":                      mustJSON(t, adp),
		at + designationsFile.path:           mustJSON(t, designations),
	})
	s := newServer(t, newDirObjects(os.DirFS(root)))
	answers := map[string]any{
		"/run/manifest":            &apitypes.RunManifestAnswer{},
		"/run/boards/" + pprFormat: &apitypes.RunBoardAnswer{},
		"/run/index":               &apitypes.RunIndexAnswer{},
		"/run/adp":                 &apitypes.RunAdpAnswer{},
		"/run/designations":        &apitypes.RunDesignationsAnswer{},
	}
	for route, into := range answers {
		rec := s.get(t, route, nil)
		if strings.Contains(rec.Body.String(), extra) {
			t.Fatalf("%s sent a member the contract does not name: %s", route, rec.Body.String())
		}
		raw, err := json.Marshal(data(t, rec))
		if err != nil {
			t.Fatal(err)
		}
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.DisallowUnknownFields()
		if err := dec.Decode(into); err != nil {
			t.Fatalf("%s: %v", route, err)
		}
	}
	if got := answers["/run/boards/"+pprFormat].(*apitypes.RunBoardAnswer); len(got.Market) != 1 || len(got.Rows) == 0 {
		t.Fatalf("the board's rows %d and market %d", len(got.Rows), len(got.Market))
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func mustObject(t *testing.T, raw string) map[string]any {
	t.Helper()
	obj, ok := decoded(t, []byte(raw)).(map[string]any)
	if !ok {
		t.Fatalf("%s is not an object", raw)
	}
	return obj
}

// With no run published yet, a failed pointer read is answered again for
// failureTTL before the bucket is asked again.
func TestColdStartFailureKept(t *testing.T) {
	objs := newDirObjects(os.DirFS(t.TempDir()))
	objs.fail["runs/latest.json"] = errors.New("r2 is down")
	s := newServer(t, objs)
	for range 3 {
		if rec := s.get(t, "/run/manifest", nil); rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("status %d; want 503", rec.Code)
		}
	}
	if got := objs.readsOf("runs/latest.json"); got != 1 {
		t.Fatalf("pointer reads %d within failureTTL; want 1", got)
	}
	*s.now = s.now.Add(failureTTL)
	s.get(t, "/run/manifest", nil)
	if got := objs.readsOf("runs/latest.json"); got != 2 {
		t.Fatalf("pointer reads %d after failureTTL; want 2", got)
	}
}

// When an hourly file's re-read fails the last good copy is served.
func TestHourlyRereadFailureKeepsCopy(t *testing.T) {
	s := fixtureServer(t)
	first := s.get(t, "/run/designations", nil)
	data(t, first)
	s.objs.fail[fileKey(fixtureRun, designationsFile.path)] = errors.New("r2 is down")
	*s.now = s.now.Add(PointerTTL)
	again := s.get(t, "/run/designations", nil)
	data(t, again)
	if again.Header().Get("ETag") != first.Header().Get("ETag") {
		t.Fatalf("ETag %s; want the last copy's %s", again.Header().Get("ETag"), first.Header().Get("ETag"))
	}
}
