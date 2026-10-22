package inseason

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"flag"
	"os"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/db/dbtest"
)

// updateDatingGolden rewrites api/testdata/designation-dating.json from
// this side's answer: go test ./internal/inseason -run TestTheDatingGolden
// -update-dating-golden. The capture job's tests then hold research to it.
var updateDatingGolden = flag.Bool("update-dating-golden", false, "rewrite api/testdata/designation-dating.json")

const (
	datingGoldenFile   = "../../testdata/designation-dating.json"
	datingCapturesFile = "../../testdata/designation-dating-captures.json.gz"
)

// datingGolden is the shared dating both lanes pin (Lane 134): the
// capture job (research/nightly/designation_dating.py) writes the row the
// API would, so both must agree on the version, the digest and the runs'
// bytes for the recorded captures, and on the table and its retention.
type datingGolden struct {
	Note      string          `json:"note"`
	Table     string          `json:"table"`
	KeptHours int             `json:"kept_hours"`
	Version   string          `json:"version"`
	CaptureAt string          `json:"capture_at"`
	Digest    string          `json:"digest"`
	Runs      json.RawMessage `json:"runs"`
}

type goldenCapture struct {
	CapturedAt string          `json:"captured_at"`
	Payload    json.RawMessage `json:"payload"`
}

func readDatingCaptures(t *testing.T) []goldenCapture {
	t.Helper()
	f, err := os.Open(datingCapturesFile)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	z, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	var captures []goldenCapture
	if err := json.NewDecoder(z).Decode(&captures); err != nil {
		t.Fatal(err)
	}
	return captures
}

// goldenSource is a research schema holding the recorded captures, read
// as the API reads it.
func goldenSource(t *testing.T) *boards.PGSource {
	t.Helper()
	pool := dbtest.Pool(t)
	ctx := context.Background()
	const schema = "dating_golden_test"
	for _, q := range []string{
		`drop schema if exists ` + schema + ` cascade`, `create schema ` + schema,
		`create table ` + schema + `.capture_snapshots (source text, payload jsonb, captured_at timestamptz)`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `drop schema if exists `+schema+` cascade`) })
	for _, c := range readDatingCaptures(t) {
		if _, err := pool.Exec(ctx, `insert into `+schema+`.capture_snapshots values ('tank01_injuries_by_date', $1, $2)`,
			string(c.Payload), c.CapturedAt); err != nil {
			t.Fatal(err)
		}
	}
	src, err := boards.NewPGSource(pool, schema, 2026, "")
	if err != nil {
		t.Fatal(err)
	}
	return src
}

// The API's dating of the recorded captures is the pinned one: its
// version, digest and runs' bytes, which the capture job's tests hold the
// research side to (one definition across the two lanes, Lane 134 ruling
// 1), and the table and its retention the job writes by.
func TestTheDatingGolden(t *testing.T) {
	src := goldenSource(t)
	ctx := context.Background()
	designations, err := src.Designations(ctx)
	if err != nil {
		t.Fatal(err)
	}
	newest := boards.Newest(designations)
	runs, err := src.DesignationRuns(ctx, newest)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := encodeRuns(runs)
	if err != nil {
		t.Fatal(err)
	}
	got := datingGolden{
		Note: "The shared capture dating (Lane 134): the API's dating of designation-dating-captures.json.gz, " +
			"which the capture job must equal byte for byte. Rewrite with go test ./internal/inseason -run " +
			"TestTheDatingGolden -update-dating-golden after any change to the run read.",
		Table: DatingsTable, KeptHours: int(DatingsKept / time.Hour), Version: boards.RunsVersion(),
		CaptureAt: newest.UTC().Format(time.RFC3339Nano), Digest: DatingDigest(designations), Runs: raw,
	}
	if *updateDatingGolden {
		out, err := json.MarshalIndent(got, "", "\t")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(datingGoldenFile, append(out, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	file, err := os.ReadFile(datingGoldenFile)
	if err != nil {
		t.Fatal(err)
	}
	var want datingGolden
	if err := json.Unmarshal(file, &want); err != nil {
		t.Fatal(err)
	}
	if got.Version != want.Version || got.Digest != want.Digest || got.CaptureAt != want.CaptureAt {
		t.Fatalf("the dating moved: version %s digest %s at %s, pinned %s %s %s; rewrite the golden "+
			"(-update-dating-golden) and the capture job with it", got.Version, got.Digest, got.CaptureAt,
			want.Version, want.Digest, want.CaptureAt)
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, want.Runs); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(raw, compact.Bytes()) {
		t.Fatalf("the runs' bytes moved from the golden's (%d runs here)", len(runs))
	}
	if want.Table != DatingsTable || time.Duration(want.KeptHours)*time.Hour != DatingsKept {
		t.Fatalf("the golden pins %s kept %d h, the API has %s kept %v", want.Table, want.KeptHours, DatingsTable, DatingsKept)
	}
	if len(runs) == 0 {
		t.Fatal("the recorded captures date nobody: the golden proves nothing")
	}
}
