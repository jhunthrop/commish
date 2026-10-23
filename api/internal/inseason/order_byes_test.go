package inseason

import (
	"net/http/httptest"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// isBye is whether a row is an available player on bye in the order's
// week, the rows byes=last puts last (Lane 163, D06).
func isBye(row apitypes.OrderRow) bool {
	d := row.Line.Facts.Designation
	return row.Line.Facts.Bye && (d == nil || d.SeasonLong == nil || !*d.SeasonLong)
}

// The Players page's week rankings never number a player on bye ahead of
// one who plays (Lane 163, D06): with byes=last, at a position and across
// positions, every bye row comes after every other row, the rows are
// numbered 1..n in that order, and a bye row's line and figures are the
// ones the order without it sends him.
func TestByesLastPutsEveryByeAfterThePlayersWhoPlay(t *testing.T) {
	f := restOfSeasonFixture(t)
	a := newFixtureAdvisor(t, f, nil)
	for _, position := range []draft.Position{"", draft.QB, draft.RB, draft.WR, draft.TE} {
		plain := a.Order(orderQuery{position: position, limit: MaxOrderRows}, nil)
		week := a.Order(orderQuery{position: position, limit: MaxOrderRows, byesLast: true}, nil)
		if week.Total != plain.Total || len(week.Rows) != len(plain.Rows) {
			t.Fatalf("%q: %d of %d rows, without it %d of %d", position, len(week.Rows), week.Total, len(plain.Rows), plain.Total)
		}
		byes, foot := 0, false
		for i, row := range week.Rows {
			if row.Rank != i+1 {
				t.Fatalf("%q row %d numbered %d", position, i, row.Rank)
			}
			if isBye(row) {
				foot = true
				byes++
				continue
			}
			if foot {
				t.Fatalf("%q: %s plays this week and sits after a bye, at %d", position, row.Line.Player.Name, row.Rank)
			}
		}
		if position == "" && byes == 0 {
			t.Fatal("the fixture's week has no bye across positions: the test proves nothing")
		}
		// The order without it keeps each bye in his place: some bye ranks ahead of a player who plays.
		if byes > 0 && !byeAheadOfAPlayer(plain.Rows) {
			t.Fatalf("%q: without byes=last no bye ranks ahead of a player who plays", position)
		}
		figures := map[string]apitypes.OrderRow{}
		for _, row := range plain.Rows {
			figures[*row.Line.Player.BoardId] = row
		}
		for _, row := range week.Rows {
			was := figures[*row.Line.Player.BoardId]
			if *row.PointsOverReplacement != *was.PointsOverReplacement || *row.RestOfSeasonPoints != *was.RestOfSeasonPoints {
				t.Fatalf("%q: %s's figures moved with byes=last", position, row.Line.Player.Name)
			}
		}
	}
}

func byeAheadOfAPlayer(rows []apitypes.OrderRow) bool {
	seen := false
	for _, row := range rows {
		if isBye(row) {
			seen = true
		} else if seen {
			return true
		}
	}
	return false
}

// byes=last is read on the public order alone, and any other value is
// refused with the field named.
func TestByesLastIsReadOnThePublicOrderAlone(t *testing.T) {
	q, bad := parseOrderQuery(httptest.NewRequest("GET", "/order?byes=last", nil), false)
	if len(bad) != 0 || !q.byesLast {
		t.Fatalf("byes=last: %+v, %v", q, bad)
	}
	if _, bad := parseOrderQuery(httptest.NewRequest("GET", "/order?byes=first", nil), false); bad[fieldByes] != byesWords {
		t.Fatalf("byes=first: %v", bad)
	}
	if q, _ := parseOrderQuery(httptest.NewRequest("GET", "/order", nil), false); q.byesLast {
		t.Fatal("no byes field reads as byes=last")
	}
	if q, bad := parseOrderQuery(httptest.NewRequest("GET", "/leagues/attached/x/order?byes=last", nil), true); q.byesLast || len(bad) != 0 {
		t.Fatalf("a league's order read byes: %+v, %v", q, bad)
	}
}
