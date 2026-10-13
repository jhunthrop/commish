package bots

// Strategy is the sampler's dials (MOCK_CONFIG.strategy).
type Strategy struct {
	Temperature             float64
	ReachDepth              int
	NeedPerOpenStartingSlot float64
	StartersFilledDamp      float64
	// BenchBodyDamp cools a bench body again per body already sitting at
	// his position, under the roster-need ceilings.
	BenchBodyDamp float64
	Run           RunReaction
}

// RunReaction tilts every brain toward a position the room is running on,
// and spikes the run follower.
type RunReaction struct {
	Window    int
	Threshold int
	NeedBoost float64
	BaseBoost float64
}

// DefaultStrategy is the founder-approved tuning: temperature 3, at most
// eight candidates, +0.4 per open starter, 0.6 once filled, 0.25 per bench
// body, and a run at three of the last four picks.
func DefaultStrategy() Strategy {
	return Strategy{
		Temperature:             3.0,
		ReachDepth:              8,
		NeedPerOpenStartingSlot: 0.4,
		StartersFilledDamp:      0.6,
		BenchBodyDamp:           0.25,
		Run:                     RunReaction{Window: 4, Threshold: 3, NeedBoost: 2.0, BaseBoost: 1.3},
	}
}

// DelayConfig is a bot's think time: base plus or minus jitter, capped
// under a fraction of the pick clock.
type DelayConfig struct {
	BaseMs             float64 `json:"baseMs"`
	JitterMs           float64 `json:"jitterMs"`
	MaxFractionOfClock float64 `json:"maxFractionOfClock"`
}

// DefaultDelay is 450 to 950 ms, never over half the clock. The solo room
// stamps no delay at all; the lobby and the pins use this.
func DefaultDelay() DelayConfig {
	return DelayConfig{BaseMs: 700, JitterMs: 250, MaxFractionOfClock: 0.5}
}
