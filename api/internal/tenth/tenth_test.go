package tenth

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

// The site's one rounding rule, as a table the web's own test reads too
// (web/src/lib/format/tenth-table.json): half away from zero on the decimal
// a figure is written as, whatever its binary value.
func TestRoundIsHalfAwayFromZeroOnTheDecimal(t *testing.T) {
	for _, c := range Table {
		if got := Round(c.In); got != c.Out {
			t.Errorf("Round(%v) = %v, want %v", c.In, got, c.Out)
		}
	}
}

// A sum of tenths carries binary noise; it rounds back to the tenth it is.
func TestRoundCleansASumOfTenths(t *testing.T) {
	sum := 20.6 + 9.7 + 11.0 + 14.2 + 7.9 + 12.3 + 9.5 + 13.2 + 3.2
	if got := Round(sum); got != 101.6 {
		t.Fatalf("Round(%v) = %v, want 101.6", sum, got)
	}
}

// Not a number passes through, and a negative that rounds to nothing is 0,
// never -0 on the wire.
func TestRoundEdges(t *testing.T) {
	if got := Round(math.NaN()); !math.IsNaN(got) {
		t.Fatalf("Round(NaN) = %v", got)
	}
	if got := Round(-0.04); math.Signbit(got) {
		t.Fatalf("Round(-0.04) = %v, want 0", got)
	}
}

// The web reads the same rows: its JSON copy must match the table.
func TestTheWebTableIsThisTable(t *testing.T) {
	raw, err := os.ReadFile("../../../web/src/lib/format/tenth-table.json")
	if err != nil {
		t.Fatal(err)
	}
	var rows []Case
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != len(Table) {
		t.Fatalf("the web table has %d rows, this one %d", len(rows), len(Table))
	}
	for i := range rows {
		if rows[i] != Table[i] {
			t.Errorf("row %d: web %v, Go %v", i, rows[i], Table[i])
		}
	}
}
