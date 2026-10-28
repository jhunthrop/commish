package notify

import (
	"context"
	"testing"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

func strp(s string) *string { return &s }
func boolp(b bool) *bool    { return &b }

// mustAt is an instant in a zone.
func mustAt(t *testing.T, zone, at string) time.Time {
	t.Helper()
	loc, err := time.LoadLocation(zone)
	if err != nil {
		t.Fatal(err)
	}
	out, err := time.ParseInLocation("2006-01-02 15:04", at, loc)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// Quiet hours push a send past their end in the member's own zone, across
// midnight, and leave a send outside them alone; a start equal to its end
// is no quiet hours.
func TestQuietHours(t *testing.T) {
	ny := DefaultPreferences()
	chicago := Preferences{TimeZone: "America/Chicago", QuietStart: 22 * 60, QuietEnd: 7*60 + 30}
	afternoon := Preferences{TimeZone: "America/New_York", QuietStart: 13 * 60, QuietEnd: 15 * 60}
	none := Preferences{TimeZone: "America/New_York", QuietStart: 0, QuietEnd: 0}
	cases := []struct {
		name string
		p    Preferences
		at   time.Time
		want time.Time
	}{
		{"before quiet", ny, mustAt(t, "America/New_York", "2026-10-25 22:59"), mustAt(t, "America/New_York", "2026-10-25 22:59")},
		{"at the start", ny, mustAt(t, "America/New_York", "2026-10-25 23:00"), mustAt(t, "America/New_York", "2026-10-26 08:00")},
		{"after midnight", ny, mustAt(t, "America/New_York", "2026-10-26 03:15"), mustAt(t, "America/New_York", "2026-10-26 08:00")},
		{"at the end", ny, mustAt(t, "America/New_York", "2026-10-26 08:00"), mustAt(t, "America/New_York", "2026-10-26 08:00")},
		{"the member's zone", chicago, mustAt(t, "America/New_York", "2026-10-25 23:30"), mustAt(t, "America/Chicago", "2026-10-26 07:30")},
		{"a span inside the day", afternoon, mustAt(t, "America/New_York", "2026-10-25 14:00"), mustAt(t, "America/New_York", "2026-10-25 15:00")},
		{"no quiet hours", none, mustAt(t, "America/New_York", "2026-10-26 03:00"), mustAt(t, "America/New_York", "2026-10-26 03:00")},
		// Standard time begins 2026-11-01 at 02:00: eight in the morning is
		// still eight on the member's clock.
		{"across the clock change", ny, mustAt(t, "America/New_York", "2026-10-31 23:30"), mustAt(t, "America/New_York", "2026-11-01 08:00")},
	}
	for _, c := range cases {
		if got := c.p.SendAfter(c.at); !got.Equal(c.want) {
			t.Errorf("%s: %v, want %v", c.name, got, c.want)
		}
	}
}

// An update changes the fields it sends and keeps the rest; a field that
// does not read refuses the whole update and leaves the preferences as
// they were.
func TestApply(t *testing.T) {
	base := DefaultPreferences()
	got, faults := Apply(base, apitypes.NotificationSettingsUpdate{
		TimeZone: strp("America/Denver"), QuietEnd: strp("09:30"),
		Kinds: &apitypes.NotificationKindsUpdate{StarterStatus: boolp(false), WaiverClaims: boolp(true)},
	})
	if faults != nil {
		t.Fatal(faults)
	}
	if got.TimeZone != "America/Denver" || got.QuietStart != DefaultQuietStart || got.QuietEnd != 9*60+30 {
		t.Fatalf("got %+v", got)
	}
	if got.On(KindStarterStatus) || !got.On(KindWeekReads) || !got.On(KindWaiverClaims) {
		t.Fatalf("kinds %v", got.Off)
	}
	wire := got.Wire()
	if wire.QuietEnd != "09:30" || wire.QuietStart != "23:00" || wire.Kinds.StarterStatus || !wire.Kinds.WeekReads {
		t.Fatalf("wire %+v", wire)
	}
	back, _ := Apply(got, apitypes.NotificationSettingsUpdate{Kinds: &apitypes.NotificationKindsUpdate{StarterStatus: boolp(true)}})
	if !back.On(KindStarterStatus) || len(back.Off) != 0 {
		t.Fatalf("switched back on: %v", back.Off)
	}

	for _, bad := range []apitypes.NotificationSettingsUpdate{
		{TimeZone: strp("Mars/Olympus")},
		{TimeZone: strp("Local")},
		{QuietStart: strp("24:00")},
		{QuietEnd: strp("7:30")},
	} {
		kept, faults := Apply(got, bad)
		if len(faults) != 1 || kept.TimeZone != got.TimeZone || kept.QuietEnd != got.QuietEnd {
			t.Fatalf("%+v: faults %v, kept %+v", bad, faults, kept)
		}
	}
}

// The settings /me carries are the defaults until the member changes one,
// and an update keeps every field it does not send.
func TestSettingsRoundTrip(t *testing.T) {
	f := newOutbox(t)
	s := &Settings{Store: f.store}
	ctx := context.Background()
	got, err := s.Notifications(ctx, f.acct)
	if err != nil || got != DefaultPreferences().Wire() || got.QuietStart != "23:00" || got.QuietEnd != "08:00" || !got.Kinds.WeekReads {
		t.Fatalf("defaults %+v %v", got, err)
	}
	if err := s.UpdateNotifications(ctx, f.acct, apitypes.NotificationSettingsUpdate{TimeZone: strp("America/Los_Angeles")}); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateNotifications(ctx, f.acct, apitypes.NotificationSettingsUpdate{
		Kinds: &apitypes.NotificationKindsUpdate{WeekReads: boolp(false)}, QuietStart: strp("21:15"),
	}); err != nil {
		t.Fatal(err)
	}
	got, err = s.Notifications(ctx, f.acct)
	if err != nil || got.TimeZone != "America/Los_Angeles" || got.QuietStart != "21:15" || got.QuietEnd != "08:00" ||
		got.Kinds.WeekReads || !got.Kinds.StarterStatus {
		t.Fatalf("after %+v %v", got, err)
	}
	if faults := s.CheckNotifications(apitypes.NotificationSettingsUpdate{QuietEnd: strp("8")}); faults["notifications.quiet_end"] == "" {
		t.Fatalf("faults %v", faults)
	}
}
