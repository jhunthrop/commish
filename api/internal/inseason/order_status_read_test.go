package inseason

import (
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// The order says the capture its rows' statuses come from (Lane 280,
// B257): the newest list's stamp and the capture job's last check, so a
// screen drawing the run's rows with the order's statuses can date its
// status column; with no capture read it says none.
func TestTheOrderSaysTheCaptureItsStatusesComeFrom(t *testing.T) {
	f := restOfSeasonFixture(t)
	none := newFixtureAdvisor(t, f, nil).Order(orderQuery{position: draft.WR, limit: MaxOrderRows}, nil)
	if none.StatusRead != nil {
		t.Fatalf("no capture read, the order says %+v", none.StatusRead)
	}
	older, newer := fixtureNow.Add(-30*time.Hour), fixtureNow.Add(-2*time.Hour)
	checked := fixtureNow.Add(-20 * time.Minute)
	f.data.Designations["p001"] = boards.Designation{Code: "IR", AsOf: older, Source: "feed", CheckedAt: &checked}
	f.data.Designations["p005"] = boards.Designation{Code: "Q", AsOf: newer, Source: "feed", CheckedAt: &checked}
	out := newFixtureAdvisor(t, f, nil).Order(orderQuery{position: draft.WR, limit: 3}, nil)
	read := out.StatusRead
	if read == nil || !read.AsOf.Equal(newer) || read.CheckedAt == nil || !read.CheckedAt.Equal(checked) || read.Source != "feed" {
		t.Fatalf("the order's status read: %+v", read)
	}
}
