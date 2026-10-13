package bots

import (
	"fmt"
	"math"
)

// DelayStreamKey is the one spelling of a pick's delay stream.
func DelayStreamKey(teamID string, pickNumber int) string {
	return fmt.Sprintf("%s:delay:%d", teamID, pickNumber)
}

// PickStreamKey is a bot's pick-selection stream in a room: one stream per
// bot for the draft's life, positioned by its own earlier draws.
func PickStreamKey(teamID string) string { return teamID }

func maxThinkDelayMs(clockSeconds float64, c DelayConfig) float64 {
	return math.Min(c.BaseMs+c.JitterMs, float64(clockSeconds*1000*c.MaxFractionOfClock))
}

// ThinkDelayMs is a bot's think time for one pick, uniform over
// [base - jitter, min(base + jitter, clock x fraction)], fractional on
// purpose: a driver stamps the first whole millisecond at or after it.
func ThinkDelayMs(clockSeconds float64, c DelayConfig, rng *Rng) float64 {
	minMs := c.BaseMs - c.JitterMs
	return minMs + float64(rng.Next()*(maxThinkDelayMs(clockSeconds, c)-minMs))
}

// ExpectedThinkDelaySeconds is the midpoint of the same interval, in seconds.
func ExpectedThinkDelaySeconds(clockSeconds float64, c DelayConfig) float64 {
	return (c.BaseMs - c.JitterMs + maxThinkDelayMs(clockSeconds, c)) / 2 / 1000
}
