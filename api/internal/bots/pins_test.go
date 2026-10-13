package bots_test

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strconv"
	"testing"

	"github.com/jhunthrop/commish/api/internal/bots"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// pins is api/testdata/pins/pins.json, exported from
// src/draft-engine/replay-pins.fixture.ts by scripts/export-pins.ts.
type pins struct {
	Seed                 int64                     `json:"seed"`
	Teams                []string                  `json:"teams"`
	Pool                 []draft.PoolEntry         `json:"pool"`
	SlotConfig           []draft.SlotConfig        `json:"slotConfig"`
	ClockSchedule        []draft.ClockTier         `json:"clockSchedule"`
	StartTimestamp       string                    `json:"startTimestamp"`
	KickoffAt            string                    `json:"kickoffAt"`
	LegacyBotSnapshot    draft.AutopickPolicy      `json:"legacyBotSnapshot"`
	SurplusClockSnapshot draft.AutopickPolicy      `json:"surplusClockSnapshot"`
	LegacyBotPicks       []string                  `json:"legacyBotPicks"`
	BotDelaysBits        []string                  `json:"botDelaysBits"`
	BotDelaysMs          []float64                 `json:"botDelaysMs"`
	BotDelayClockSeconds float64                   `json:"botDelayClockSeconds"`
	SurplusClockPicks    []string                  `json:"surplusClockPicks"`
	ArchetypeDeal        map[string]bots.Archetype `json:"archetypeDeal"`
	RawSeedDraws         []string                  `json:"rawSeedDraws"`
	RngVectors           []struct {
		Seed  int64    `json:"seed"`
		Key   string   `json:"key"`
		Draws []string `json:"draws"`
	} `json:"rngVectors"`
}

func loadPins(t *testing.T) pins {
	t.Helper()
	raw, err := os.ReadFile("../../testdata/pins/pins.json")
	if err != nil {
		t.Fatalf("read pins: %v", err)
	}
	var p pins
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatalf("decode pins: %v", err)
	}
	return p
}

func bitsOf(f float64) string { return fmt.Sprintf("%016x", math.Float64bits(f)) }

func (p pins) seed() uint32 { return bots.SeedBits(p.Seed) }

func (p pins) config() draft.Config {
	return draft.Config{
		DraftID: "d_pin", LeagueID: "l_pin", Format: draft.Snake, KickoffAt: p.KickoffAt,
		SlotConfig: p.SlotConfig, ClockSchedule: p.ClockSchedule,
	}
}

func (p pins) started(t *testing.T, snapshot draft.AutopickPolicy) draft.State {
	t.Helper()
	start := draft.Action{Type: draft.StartDraft, Timestamp: p.StartTimestamp, DraftOrder: p.Teams, Pool: p.Pool, MinBid: 1, Autopick: &snapshot}
	s, err := draft.Submit(draft.Initial(p.config()), start)
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	return s
}

// TestRngStreamsMatchV8 checks mulberry32 and FNV-1a keying draw for draw.
func TestRngStreamsMatchV8(t *testing.T) {
	p := loadPins(t)
	raw := bots.NewRng(p.seed())
	for i, want := range p.RawSeedDraws {
		if got := bitsOf(raw.Next()); got != want {
			t.Fatalf("raw draw %d = %s, TypeScript %s", i, got, want)
		}
	}
	draws := 0
	for _, v := range p.RngVectors {
		rng := bots.RngFor(bots.SeedBits(v.Seed), v.Key)
		for i, want := range v.Draws {
			if got := bitsOf(rng.Next()); got != want {
				t.Fatalf("rngFor(%d, %q) draw %d = %s, TypeScript %s", v.Seed, v.Key, i, got, want)
			}
			draws++
		}
	}
	t.Logf("rng: %d raw draws and %d keyed draws over %d streams match", len(p.RawSeedDraws), draws, len(p.RngVectors))
}

func TestArchetypeDealMatches(t *testing.T) {
	p := loadPins(t)
	dealt := bots.AssignArchetypes(p.seed(), p.Teams)
	for _, team := range p.Teams {
		if dealt[team].Name != p.ArchetypeDeal[team].Name {
			t.Errorf("%s dealt %s, TypeScript %s", team, dealt[team].Name, p.ArchetypeDeal[team].Name)
		}
	}
}

// TestLegacyBotPicksPin is PIN_LEGACY_BOT_PICKS: sixty seeded bot picks on
// the real board under the snapshot without ceilings, byte for byte.
func TestLegacyBotPicksPin(t *testing.T) {
	p := loadPins(t)
	dealt := bots.AssignArchetypes(p.seed(), p.Teams)
	s := p.started(t, p.LegacyBotSnapshot)
	for i, want := range p.LegacyBotPicks {
		team, ok := draft.TeamOnClock(s)
		if !ok {
			t.Fatalf("no team on the clock at pick %d", s.PickNumber)
		}
		rng := bots.RngFor(p.seed(), fmt.Sprintf("%s:pin:%d", team, s.PickNumber))
		got, ok := bots.ChooseBotPick(s, team, dealt[team], bots.DefaultStrategy(), rng)
		if !ok || got != want {
			t.Fatalf("legacy bot pick %d (%s) = %q, pinned %q", i+1, team, got, want)
		}
		next, err := draft.Submit(s, draft.NewMakePick(p.StartTimestamp, team, got))
		if err != nil {
			t.Fatalf("pick %d: %v", i+1, err)
		}
		s = next
	}
	t.Logf("legacy bot picks: %d of %d match", len(p.LegacyBotPicks), len(p.LegacyBotPicks))
}

// TestBotDelayPin is PIN_BOT_DELAYS_MS: 24 think delays, every bit.
func TestBotDelayPin(t *testing.T) {
	p := loadPins(t)
	for i, want := range p.BotDelaysBits {
		pick := i + 1
		team, err := draft.SnakeTeamForPick(p.Teams, pick)
		if err != nil {
			t.Fatal(err)
		}
		got := bots.ThinkDelayMs(p.BotDelayClockSeconds, bots.DefaultDelay(), bots.RngFor(p.seed(), bots.DelayStreamKey(team, pick)))
		if bitsOf(got) != want {
			t.Fatalf("delay %d = %v (%s), pinned %v (%s)", pick, got, bitsOf(got), p.BotDelaysMs[i], want)
		}
		if strconv.FormatFloat(got, 'g', -1, 64) != strconv.FormatFloat(p.BotDelaysMs[i], 'g', -1, 64) {
			t.Fatalf("delay %d prints %v, pinned %v", pick, got, p.BotDelaysMs[i])
		}
	}
	t.Logf("bot delays: %d of %d match bit for bit", len(p.BotDelaysBits), len(p.BotDelaysBits))
}

// TestSurplusClockPicksPin is PIN_SURPLUS_CLOCK_PICKS: sixty clock
// autopicks under the 2026-09-05 snapshot, each expiry at the deadline.
func TestSurplusClockPicksPin(t *testing.T) {
	p := loadPins(t)
	s := p.started(t, p.SurplusClockSnapshot)
	for i, want := range p.SurplusClockPicks {
		deadline, ok, err := draft.CurrentDeadline(s)
		if err != nil || !ok {
			t.Fatalf("no deadline at pick %d: %v", s.PickNumber, err)
		}
		next, err := draft.Submit(s, draft.NewTimerExpire(deadline))
		if err != nil {
			t.Fatalf("expiry %d: %v", i+1, err)
		}
		s = next
		if got := s.Picks[len(s.Picks)-1].PlayerID; got != want {
			t.Fatalf("clock pick %d = %q, pinned %q", i+1, got, want)
		}
	}
	t.Logf("surplus clock picks: %d of %d match", len(p.SurplusClockPicks), len(p.SurplusClockPicks))
}
