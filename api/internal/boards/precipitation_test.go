package boards

import (
	"encoding/json"
	"os"
	"slices"
	"testing"
)

// The forecast's kind codes are research's PRECIPITATION_KINDS, by index:
// both sides test against one file.
func TestPrecipitationKindsAreTheSharedList(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/precipitation-kinds.json")
	if err != nil {
		t.Fatal(err)
	}
	var shared struct {
		Kinds []string `json:"kinds"`
	}
	if err := json.Unmarshal(raw, &shared); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(PrecipitationKinds(), shared.Kinds) {
		t.Fatalf("kinds %v, the shared list %v", PrecipitationKinds(), shared.Kinds)
	}
	for code, want := range map[float64]string{0: "none", 3: "snow"} {
		if got := kindOf(map[string]float64{metricKind: code}); got == nil || *got != want {
			t.Fatalf("code %v: %v, want %s", code, got, want)
		}
	}
	for _, code := range []float64{-1, 5, 1.5} {
		if got := kindOf(map[string]float64{metricKind: code}); got != nil {
			t.Fatalf("code %v reads as %s", code, *got)
		}
	}
}
