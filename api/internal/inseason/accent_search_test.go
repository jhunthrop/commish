package inseason

import (
	"testing"

	"github.com/jhunthrop/commish/api/internal/boards"
)

// A search typed without his accent finds him, and one typed with it
// still does (Lane 78: the board spells him "Audric Estimé").
func TestSearchReadsHisNameWithOrWithoutTheAccent(t *testing.T) {
	p := boards.Player{Name: "Audric Estimé", Team: "DEN"}
	for _, q := range []string{"estime", "Estimé", "AUDRIC EST"} {
		if !matches(p, q) {
			t.Errorf("search %q does not find %q", q, p.Name)
		}
	}
}
