package inseason

import (
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/figurewords"
)

// The order's basis names its rest-of-season total by the head the web
// draws over it, read from the one table (figurewords, the sweep's X2).
func TestTheOrderBasisNamesItsTotalByItsHead(t *testing.T) {
	basis := OrderScreenBasis(RestOfSeason, RestFrom{Week: 7}, OrderLeague(false, PublicSettings(), apitypes.ProjectionScoringFormatPpr), StandardHorizon)
	if !strings.Contains(basis, figurewords.Table.Projected+" through week") ||
		strings.Contains(basis, figurewords.Table.Points+" through") {
		t.Fatalf("the order's basis does not name its total %s: %q", figurewords.Table.Projected, basis)
	}
}

// The figure a game is said by its one head, the web's over the column.
func TestPerGameIsSaidByItsHead(t *testing.T) {
	if !strings.HasPrefix(PerGameBasis(), figurewords.Table.PerGame+" is ") {
		t.Fatalf("%q", PerGameBasis())
	}
}
