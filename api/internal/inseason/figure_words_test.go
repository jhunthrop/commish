package inseason

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// The heads the API's sentences name are the site's one word for each
// figure (web/src/lib/format/figure-words.json, the ruling on the sweep's
// X2): the order's basis names its rest-of-season total Projected, as the
// column the web draws over it is headed.
func TestFigureWordsAreTheSharedTable(t *testing.T) {
	raw, err := os.ReadFile("../../../web/src/lib/format/figure-words.json")
	if err != nil {
		t.Fatal(err)
	}
	var table map[string]string
	if err := json.Unmarshal(raw, &table); err != nil {
		t.Fatal(err)
	}
	if table["projected"] != HeadProjected {
		t.Fatalf("projected head %q, the table's %q", HeadProjected, table["projected"])
	}
	basis := OrderScreenBasis(RestOfSeason, 7, PublicSettings())
	if strings.Contains(basis, table["points"]+" through") || !strings.Contains(basis, HeadProjected+" through week") {
		t.Fatalf("the order's basis does not name its total %s: %q", HeadProjected, basis)
	}
}
