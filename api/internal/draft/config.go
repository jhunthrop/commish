package draft

// ClockTier is one tier of the auto-tightening pick clock: it applies while
// the draft is more than UntilHoursBeforeKickoff hours from kickoff.
type ClockTier struct {
	UntilHoursBeforeKickoff float64 `json:"untilHoursBeforeKickoff"`
	PickSeconds             int     `json:"pickSeconds"`
}

// PauseWindow is the overnight freeze: a deadline that would land between
// StartHour and EndHour local time in Zone is pushed past it, only while
// the tier's pick clock is AppliesAtOrAbovePickSeconds or longer.
type PauseWindow struct {
	Zone                        string `json:"zone"`
	StartHour                   int    `json:"startHour"`
	EndHour                     int    `json:"endHour"`
	AppliesAtOrAbovePickSeconds int    `json:"appliesAtOrAbovePickSeconds"`
}

// SkipPolicy is the skip-and-owe allowance, snapshotted on START_DRAFT.
type SkipPolicy struct {
	MaxOwedPerTeam              int `json:"maxOwedPerTeam"`
	AppliesAtOrAbovePickSeconds int `json:"appliesAtOrAbovePickSeconds"`
}

// CeilingPolicy is the roster-need ceilings' one dial.
type CeilingPolicy struct {
	BackupsAtSingleStarterPosition int `json:"backupsAtSingleStarterPosition"`
}

// AutopickPolicy is the need-aware autopick scoring snapshotted on
// START_DRAFT. An absent optional field means the behaviour of the logs
// written before it existed, never today's value.
type AutopickPolicy struct {
	Temperature                float64        `json:"temperature"`
	NeedPerOpenStartingSlot    float64        `json:"needPerOpenStartingSlot"`
	StartersFilledDamp         float64        `json:"startersFilledDamp"`
	RampFullAtRosterFraction   float64        `json:"rampFullAtRosterFraction"`
	SurplusDamp                *float64       `json:"surplusDamp,omitempty"`
	LateRoundOnlyRoundsFromEnd *int           `json:"lateRoundOnlyRoundsFromEnd,omitempty"`
	RosterCeilings             *CeilingPolicy `json:"rosterCeilings,omitempty"`
}

// Config is the draft's static setup.
type Config struct {
	DraftID       string       `json:"draftId"`
	LeagueID      string       `json:"leagueId"`
	Format        Format       `json:"format"`
	KickoffAt     string       `json:"kickoffAt"`
	AuctionBudget *int         `json:"auctionBudget"`
	SlotConfig    []SlotConfig `json:"slotConfig"`
	ClockSchedule []ClockTier  `json:"clockSchedule"`
	PauseWindow   *PauseWindow `json:"pauseWindow,omitempty"`
	// SkipPolicy and Autopick are set by START_DRAFT from the action, never
	// by whoever builds the Config.
	SkipPolicy *SkipPolicy     `json:"skipPolicy,omitempty"`
	Autopick   *AutopickPolicy `json:"autopick,omitempty"`
	IsMock     bool            `json:"isMock,omitempty"`
}

// StandardRosterSlots is the canonical 15-slot roster (src/domain/roster.ts).
func StandardRosterSlots() []SlotConfig {
	return []SlotConfig{
		{Slot: SlotQB, Count: 1, EligiblePositions: []Position{QB}},
		{Slot: SlotRB, Count: 2, EligiblePositions: []Position{RB}},
		{Slot: SlotWR, Count: 2, EligiblePositions: []Position{WR}},
		{Slot: SlotTE, Count: 1, EligiblePositions: []Position{TE}},
		{Slot: SlotFlex, Count: 1, EligiblePositions: []Position{RB, WR, TE}},
		{Slot: SlotK, Count: 1, EligiblePositions: []Position{K}},
		{Slot: SlotDEF, Count: 1, EligiblePositions: []Position{DEF}},
		{Slot: SlotBench, Count: 6, EligiblePositions: []Position{QB, RB, WR, TE, K, DEF}},
	}
}

// DraftClockSchedule is 8h, 4h, 1h, 10m, then 90 seconds at kickoff.
func DraftClockSchedule() []ClockTier {
	return []ClockTier{
		{UntilHoursBeforeKickoff: 168, PickSeconds: 8 * 60 * 60},
		{UntilHoursBeforeKickoff: 48, PickSeconds: 4 * 60 * 60},
		{UntilHoursBeforeKickoff: 12, PickSeconds: 60 * 60},
		{UntilHoursBeforeKickoff: 2, PickSeconds: 10 * 60},
		{UntilHoursBeforeKickoff: 0, PickSeconds: 90},
	}
}

// DraftPauseWindow is 2 AM to 5 AM Eastern, at hour-or-longer clocks.
func DraftPauseWindow() PauseWindow {
	return PauseWindow{Zone: "America/New_York", StartHour: 2, EndHour: 5, AppliesAtOrAbovePickSeconds: 60 * 60}
}

// DraftSkipPolicy is one owed pick per team, at hour-or-longer clocks.
func DraftSkipPolicy() SkipPolicy {
	return SkipPolicy{MaxOwedPerTeam: 1, AppliesAtOrAbovePickSeconds: 60 * 60}
}

// AutopickConfig is today's autopick snapshot (src/draft-engine/config.ts
// AUTOPICK_CONFIG): temperature 3, +0.4 per open starting slot, 0.6 once
// filled, full weight at half the roster, 0.25 per surplus body, K and DEF
// in the last two rounds, one backup at a single-starter position.
func AutopickConfig() AutopickPolicy {
	surplus := 0.25
	lateRounds := 2
	return AutopickPolicy{
		Temperature:                3.0,
		NeedPerOpenStartingSlot:    0.4,
		StartersFilledDamp:         0.6,
		RampFullAtRosterFraction:   0.5,
		SurplusDamp:                &surplus,
		LateRoundOnlyRoundsFromEnd: &lateRounds,
		RosterCeilings:             &CeilingPolicy{BackupsAtSingleStarterPosition: 1},
	}
}

// Auction tunables (AUCTION_CONFIG), read by Admit and the selectors only.
const (
	AuctionMinBid             = 1
	AuctionBidIncrement       = 1
	AuctionBidWindowSeconds   = 15
	AuctionReservePerOpenSlot = 1
)

// QueueMaxLength is the longest queue a team may submit (Admit only).
const QueueMaxLength = 50

// PersistedQueueMax is the ceiling a persisted SET_QUEUE row is validated
// against. Never lowered: rows written under it must keep replaying.
const PersistedQueueMax = 100

// UpcomingCount is how far ahead the clock view looks.
const UpcomingCount = 12
