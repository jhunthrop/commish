package draft

import (
	"fmt"
	"math"
)

const (
	msPerSecond = 1000
	msPerHour   = 60 * 60 * msPerSecond
)

// hoursUntil is hours from at until kickoff, negative after kickoff.
func hoursUntil(atMs, kickoffMs int64) float64 {
	return float64(kickoffMs-atMs) / msPerHour
}

// tierIndexFor is the tier in force: the first one the draft is strictly
// more than its threshold from kickoff, else the last (the floor).
func tierIndexFor(atMs, kickoffMs int64, schedule []ClockTier) (int, error) {
	if len(schedule) == 0 {
		return 0, fmt.Errorf("draft: the clock schedule must have at least one tier")
	}
	hours := hoursUntil(atMs, kickoffMs)
	for i, tier := range schedule {
		if hours > tier.UntilHoursBeforeKickoff {
			return i, nil
		}
	}
	return len(schedule) - 1, nil
}

// CurrentTier is the tier for the running turn; false when no turn runs,
// the schedule is empty or a timestamp does not parse.
func CurrentTier(s State) (ClockTier, bool) {
	if s.Phase != PhaseInProgress || s.TurnStartedAt == nil {
		return ClockTier{}, false
	}
	at, err := ParseMillis(*s.TurnStartedAt)
	if err != nil {
		return ClockTier{}, false
	}
	kickoff, err := ParseMillis(s.Config.KickoffAt)
	if err != nil {
		return ClockTier{}, false
	}
	i, err := tierIndexFor(at, kickoff, s.Config.ClockSchedule)
	if err != nil {
		return ClockTier{}, false
	}
	return s.Config.ClockSchedule[i], true
}

// CurrentClockSeconds is the turn's length: the tier's pick clock, or the
// shorter bid window while a lot is open.
func CurrentClockSeconds(s State) (int, bool) {
	tier, ok := CurrentTier(s)
	if !ok {
		return 0, false
	}
	if a := AuctionOf(s); a != nil && a.Lot != nil {
		return min(tier.PickSeconds, AuctionBidWindowSeconds), true
	}
	return tier.PickSeconds, true
}

// effectivePauseWindow is the configured freeze when the current tier is
// slow enough for it.
func effectivePauseWindow(s State) *PauseWindow {
	tier, ok := CurrentTier(s)
	if s.Config.PauseWindow == nil || !ok || tier.PickSeconds < s.Config.PauseWindow.AppliesAtOrAbovePickSeconds {
		return nil
	}
	return s.Config.PauseWindow
}

// CurrentDeadline is when the running turn's clock runs out, pushed past
// the overnight freeze where one applies.
func CurrentDeadline(s State) (string, bool, error) {
	return deadlineAt(s, 1)
}

// NudgeDeadline is thresholdPct of the way from the turn's start to its
// deadline, pushed past the freeze the same way.
func NudgeDeadline(s State, thresholdPct float64) (string, bool, error) {
	return deadlineAt(s, thresholdPct/100)
}

func deadlineAt(s State, fraction float64) (string, bool, error) {
	seconds, ok := CurrentClockSeconds(s)
	if !ok || s.TurnStartedAt == nil {
		return "", false, nil
	}
	start, err := ParseMillis(*s.TurnStartedAt)
	if err != nil {
		return "", false, err
	}
	length := float64(seconds)
	if fraction != 1 {
		length = float64(seconds) * fraction
	}
	window := effectivePauseWindow(s)
	if window == nil {
		return FormatMillis(addSeconds(start, length)), true, nil
	}
	deadline, err := deadlineAfter(start, length, *window)
	if err != nil {
		return "", false, err
	}
	return FormatMillis(deadline), true, nil
}

// addSeconds is new Date(Date.parse(start) + seconds * 1000): the sum in
// float milliseconds, a fractional millisecond truncated as new Date does.
func addSeconds(startMs int64, seconds float64) int64 {
	return int64(math.Trunc(float64(startMs) + float64(seconds*msPerSecond)))
}

// Tightening is when the clock next shortens, and to what.
type Tightening struct {
	At          string `json:"at"`
	PickSeconds int    `json:"pickSeconds"`
}

// NextTightening is the next shorter tier; false on the last tier or with
// no turn running.
func NextTightening(s State) (Tightening, bool) {
	if s.Phase != PhaseInProgress || s.TurnStartedAt == nil {
		return Tightening{}, false
	}
	at, err1 := ParseMillis(*s.TurnStartedAt)
	kickoff, err2 := ParseMillis(s.Config.KickoffAt)
	if err1 != nil || err2 != nil {
		return Tightening{}, false
	}
	i, err := tierIndexFor(at, kickoff, s.Config.ClockSchedule)
	if err != nil || i+1 >= len(s.Config.ClockSchedule) {
		return Tightening{}, false
	}
	current := s.Config.ClockSchedule[i]
	when := kickoff - int64(current.UntilHoursBeforeKickoff*msPerHour)
	return Tightening{At: FormatMillis(when), PickSeconds: s.Config.ClockSchedule[i+1].PickSeconds}, true
}
