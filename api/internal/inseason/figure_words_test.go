package inseason

import (
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/figurewords"
)

// The order's basis names its rest-of-season total by the head the web
// draws over it, read from the one table (figurewords, the sweep's X2).
func TestTheOrderBasisNamesItsTotalByItsHead(t *testing.T) {
	basis := OrderScreenBasis(RestOfSeason, 7, PublicSettings())
	if !strings.Contains(basis, figurewords.Table.Projected+" through week") ||
		strings.Contains(basis, figurewords.Table.Points+" through") {
		t.Fatalf("the order's basis does not name its total %s: %q", figurewords.Table.Projected, basis)
	}
}
