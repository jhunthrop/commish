package notify

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // a member's zone reads on the distroless image

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// The defaults a member with no row holds: quiet from 23:00 to 08:00 in
// New York time, every kind on (spec §5.3).
const (
	DefaultTimeZone   = "America/New_York"
	DefaultQuietStart = 23 * 60
	DefaultQuietEnd   = 8 * 60
	maxTimeZoneLen    = 64
)

// Preferences is a member's push preferences: quiet hours in their own
// zone, minutes after local midnight, and the kinds switched off.
type Preferences struct {
	TimeZone   string
	QuietStart int
	QuietEnd   int
	Off        []Kind
}

// DefaultPreferences is what a member who changed nothing holds.
func DefaultPreferences() Preferences {
	return Preferences{TimeZone: DefaultTimeZone, QuietStart: DefaultQuietStart, QuietEnd: DefaultQuietEnd}
}

// On reports whether the kind is switched on.
func (p Preferences) On(k Kind) bool { return !slices.Contains(p.Off, k) }

// location is the member's zone; a zone that no longer loads (its row
// written by an older tz database) reads as the default, never an error
// at send time.
func (p Preferences) location() *time.Location {
	if loc, err := time.LoadLocation(p.TimeZone); err == nil {
		return loc
	}
	loc, _ := time.LoadLocation(DefaultTimeZone)
	return loc
}

// quiet reports whether a minute of the local day falls in quiet hours,
// which may run past midnight.
func (p Preferences) quiet(minute int) bool {
	switch {
	case p.QuietStart == p.QuietEnd:
		return false
	case p.QuietStart < p.QuietEnd:
		return minute >= p.QuietStart && minute < p.QuietEnd
	default:
		return minute >= p.QuietStart || minute < p.QuietEnd
	}
}

// SendAfter is when a push due at at may go: at itself outside quiet
// hours, else the next end of quiet hours in the member's zone.
func (p Preferences) SendAfter(at time.Time) time.Time {
	local := at.In(p.location())
	if !p.quiet(local.Hour()*60 + local.Minute()) {
		return at
	}
	y, m, d := local.Date()
	end := time.Date(y, m, d, p.QuietEnd/60, p.QuietEnd%60, 0, 0, local.Location())
	if !end.After(local) {
		end = time.Date(y, m, d+1, p.QuietEnd/60, p.QuietEnd%60, 0, 0, local.Location())
	}
	return end.UTC()
}

// Wire is the preferences as /me carries them.
func (p Preferences) Wire() apitypes.NotificationSettings {
	return apitypes.NotificationSettings{
		TimeZone: p.TimeZone, QuietStart: hhmm(p.QuietStart), QuietEnd: hhmm(p.QuietEnd),
		Kinds: apitypes.NotificationKinds{
			StarterStatus: p.On(KindStarterStatus), WeekReads: p.On(KindWeekReads), WaiverClaims: p.On(KindWaiverClaims),
		},
	}
}

// hhmm is minutes after midnight as HH:MM.
func hhmm(minutes int) string { return fmt.Sprintf("%02d:%02d", minutes/60, minutes%60) }

// parseClock reads HH:MM, 00:00 to 23:59.
func parseClock(s string) (int, bool) {
	h, m, ok := strings.Cut(s, ":")
	if !ok || len(h) != 2 || len(m) != 2 {
		return 0, false
	}
	hours, err1 := strconv.Atoi(h)
	mins, err2 := strconv.Atoi(m)
	if err1 != nil || err2 != nil || hours < 0 || hours > 23 || mins < 0 || mins > 59 {
		return 0, false
	}
	return hours*60 + mins, true
}

// The refusals, by field.
const (
	badZone  = "Send an IANA time zone, like America/Chicago"
	badClock = "Send a time as HH:MM, 00:00 to 23:59"
)

// Apply is p with the update's fields changed, or the faults by field
// when one does not read; p itself is never changed.
func Apply(p Preferences, u apitypes.NotificationSettingsUpdate) (Preferences, map[string]string) {
	out := p
	out.Off = slices.Clone(p.Off)
	faults := map[string]string{}
	if u.TimeZone != nil {
		zone := strings.TrimSpace(*u.TimeZone)
		if _, err := time.LoadLocation(zone); err != nil || zone == "" || zone == "Local" || len(zone) > maxTimeZoneLen {
			faults["notifications.time_zone"] = badZone
		}
		out.TimeZone = zone
	}
	for field, raw := range map[string]*string{"notifications.quiet_start": u.QuietStart, "notifications.quiet_end": u.QuietEnd} {
		if raw == nil {
			continue
		}
		minutes, ok := parseClock(*raw)
		if !ok {
			faults[field] = badClock
			continue
		}
		if field == "notifications.quiet_start" {
			out.QuietStart = minutes
		} else {
			out.QuietEnd = minutes
		}
	}
	if u.Kinds != nil {
		out.Off = switched(out.Off, map[Kind]*bool{
			KindStarterStatus: u.Kinds.StarterStatus, KindWeekReads: u.Kinds.WeekReads, KindWaiverClaims: u.Kinds.WaiverClaims,
		})
	}
	if len(faults) > 0 {
		return p, faults
	}
	return out, nil
}

// switched is the kinds off after the switches sent, in Kinds' order.
func switched(off []Kind, sent map[Kind]*bool) []Kind {
	out := []Kind{}
	for _, k := range Kinds() {
		on := !slices.Contains(off, k)
		if v := sent[k]; v != nil {
			on = *v
		}
		if !on {
			out = append(out, k)
		}
	}
	return out
}
