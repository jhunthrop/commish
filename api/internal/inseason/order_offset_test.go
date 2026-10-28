package inseason

import (
	"net/http/httptest"
	"testing"

	"github.com/jhunthrop/commish/api/internal/draft"
)

// An app reads the whole order a page at a time (Lane 280): ?offset=
// skips the view's first rows, each row keeps its place, total is the
// view's whole, and the pages together are the order once.
func TestOrderPagesByOffsetKeepPlacesAndTheTotal(t *testing.T) {
	f := restOfSeasonFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	all := a.Order(orderQuery{position: draft.WR, limit: MaxOrderRows}, nil)
	const page = 3
	if len(all.Rows) <= page {
		t.Fatalf("the fixture holds %d receivers, too few to page", len(all.Rows))
	}
	var joined []string
	for offset := 0; offset < all.Total; offset += page {
		got := a.Order(orderQuery{position: draft.WR, limit: page, offset: offset}, nil)
		if got.Total != all.Total {
			t.Fatalf("offset %d: total %d, want %d", offset, got.Total, all.Total)
		}
		for i, row := range got.Rows {
			if want := all.Rows[offset+i]; *row.Line.Player.BoardId != *want.Line.Player.BoardId || row.Rank != want.Rank {
				t.Fatalf("offset %d row %d: %s at %d, want %s at %d", offset, i, *row.Line.Player.BoardId, row.Rank, *want.Line.Player.BoardId, want.Rank)
			}
			joined = append(joined, *row.Line.Player.BoardId)
		}
	}
	if len(joined) != len(all.Rows) {
		t.Fatalf("the pages hold %d rows, the order %d", len(joined), len(all.Rows))
	}
	past := a.Order(orderQuery{position: draft.WR, limit: page, offset: all.Total}, nil)
	if len(past.Rows) != 0 || past.Total != all.Total {
		t.Fatalf("past the end: %d rows of %d", len(past.Rows), past.Total)
	}
}

func TestOrderOffsetIsReadAndANegativeOneRefused(t *testing.T) {
	q, bad := parseOrderQuery(httptest.NewRequest("GET", "/order?offset=400&limit=400", nil), false)
	if len(bad) != 0 || q.offset != 400 || q.limit != 400 {
		t.Fatalf("offset=400: %+v %v", q, bad)
	}
	for _, raw := range []string{"-1", "x"} {
		if _, bad := parseOrderQuery(httptest.NewRequest("GET", "/order?offset="+raw, nil), false); bad[fieldOffset] != offsetWords {
			t.Fatalf("offset=%s: %v", raw, bad)
		}
	}
}
