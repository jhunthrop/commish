package boards

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/season"
)

// returningCases is the shared file's return rule (Lane 153):
// research/tests/test_designations.py reads the same cases.
type returningCases struct {
	Returning struct {
		ThisWeekStatus string `json:"this_week_status"`
		Cases          []struct {
			Name        string  `json:"name"`
			Status      string  `json:"status"`
			Returning   *string `json:"returning"`
			LastGameDay *string `json:"last_game_day"`
			Today       string  `json:"today"`
			Reads       string  `json:"reads"`
		} `json:"cases"`
	} `json:"returning"`
}

var returnWords = map[string]Return{"none": ReturnNone, "this_week": ReturnThisWeek, "later": ReturnLater}

func easternDay(t *testing.T, day string, add int) time.Time {
	t.Helper()
	on, err := time.ParseInLocation(time.DateOnly, day, season.Eastern())
	if err != nil {
		t.Fatal(err)
	}
	return on.AddDate(0, 0, add)
}

func TestReturnOfReadsTheSharedCases(t *testing.T) {
	raw, err := os.ReadFile("../../testdata/designation-codes.json")
	if err != nil {
		t.Fatal(err)
	}
	var file returningCases
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	if file.Returning.ThisWeekStatus != ReturningStatus {
		t.Errorf("a return this week reads %q here, %q in the shared file", ReturningStatus, file.Returning.ThisWeekStatus)
	}
	if len(file.Returning.Cases) == 0 {
		t.Fatal("the shared file holds no return cases")
	}
	for _, tc := range file.Returning.Cases {
		var on *time.Time
		if tc.Returning != nil {
			day := easternDay(t, *tc.Returning, 0)
			on = &day
		}
		var weekEnd time.Time
		if tc.LastGameDay != nil {
			weekEnd = easternDay(t, *tc.LastGameDay, 1)
		}
		// Noon and the last minute of the day: the rule reads days, never the hour.
		for _, now := range []time.Time{easternDay(t, tc.Today, 0).Add(12 * time.Hour), easternDay(t, tc.Today, 1).Add(-time.Minute)} {
			want, ok := returnWords[tc.Reads]
			if !ok {
				t.Fatalf("%s: unknown reading %q", tc.Name, tc.Reads)
			}
			if got := ReturnOf(tc.Status, on, weekEnd, now); got != want {
				t.Errorf("%s at %v: ReturnOf = %v, want %v", tc.Name, now, got, want)
			}
		}
	}
}
