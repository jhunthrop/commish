package draft

// ClockView is whose turn, until when, and what changes next: what every
// room event and the full view carry (draftClockView, selectors.ts).
type ClockView struct {
	Phase          Phase            `json:"phase"`
	Sequence       int              `json:"sequence"`
	PickNumber     int              `json:"pickNumber"`
	OnClockTeamID  *string          `json:"onClockTeamId"`
	DeadlineAt     *string          `json:"deadlineAt"`
	ClockSeconds   *int             `json:"clockSeconds"`
	NextTightening *Tightening      `json:"nextTightening"`
	Upcoming       []string         `json:"upcoming"`
	PausedUntil    *string          `json:"pausedUntil"`
	OwedPicks      map[string][]int `json:"owedPicks"`
}

// NewClockView builds the clock view of s.
func NewClockView(s State) (ClockView, error) {
	v := ClockView{
		Phase: s.Phase, Sequence: s.Sequence, PickNumber: s.PickNumber,
		Upcoming: UpcomingOnClock(s, UpcomingCount), OwedPicks: s.OwedPicks,
	}
	if team, ok := TeamOnClock(s); ok {
		v.OnClockTeamID = &team
	}
	deadline, ok, err := CurrentDeadline(s)
	if err != nil {
		return ClockView{}, err
	}
	if ok {
		v.DeadlineAt = &deadline
	}
	if seconds, ok := CurrentClockSeconds(s); ok {
		v.ClockSeconds = &seconds
	}
	if t, ok := NextTightening(s); ok {
		v.NextTightening = &t
	}
	paused, ok, err := PausedUntilFor(s)
	if err != nil {
		return ClockView{}, err
	}
	if ok {
		v.PausedUntil = &paused
	}
	return v, nil
}
