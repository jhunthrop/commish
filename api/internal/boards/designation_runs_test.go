package boards

import (
	"regexp"
	"strings"
	"testing"
	"time"
)

// The run read's text binds every parameter by position, in the order
// DesignationRuns passes them, and holds no "::" cast a named parameter
// could be read out of.
func TestRunsSQLBindsEveryParameterByPosition(t *testing.T) {
	if strings.Contains(runsQuery, "::") {
		t.Fatal("designation_runs.sql holds a :: cast; write cast(x as t), so its names read one way")
	}
	query := runsSQL(`"research"."capture_snapshots"`)
	if left := regexp.MustCompile(`:[a-z_]+|\{\{`).FindString(query); left != "" {
		t.Fatalf("the run read keeps %q unbound", left)
	}
	for i, want := range []string{"source = $1", "captured_at <= $2", "captured_at > $3", "limit $4", "cast($5 as text[])", "cast($6 as text[])", `from "research"."capture_snapshots"`} {
		if !strings.Contains(query, want) {
			t.Errorf("bind %d: the run read lacks %q", i+1, want)
		}
	}
}

// The version is derived from the run read's inputs (B114): a change to
// the text, the window or the cap is a new version, the same inputs the
// same one.
func TestRunsVersionMovesWithEachInput(t *testing.T) {
	base := runsVersionOf(runsQuery, runWindow, maxRunCaptures)
	if base != RunsVersion() || !regexp.MustCompile(`^runs-[0-9a-f]{16}$`).MatchString(base) {
		t.Fatalf("RunsVersion %q, derived %q", RunsVersion(), base)
	}
	for name, other := range map[string]string{
		"text":   runsVersionOf(runsQuery+" ", runWindow, maxRunCaptures),
		"window": runsVersionOf(runsQuery, runWindow-time.Hour, maxRunCaptures),
		"cap":    runsVersionOf(runsQuery, runWindow, maxRunCaptures+1),
	} {
		if other == base {
			t.Errorf("a change to the %s keeps version %s", name, base)
		}
	}
}
