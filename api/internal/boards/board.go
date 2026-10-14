// Package boards is the board the rooms draft from: every player in the
// order drafters take them (the pool the engine and the bots read), his
// projected points under the league's scoring, and his points over
// replacement under the league's own roster shape. The research lane's
// tables are the source (spec §2.5, no file-sourced data at runtime); the
// value over replacement is recomputed per league here from the stored
// points, the way the research board does it (decide/replacement.ts).
package boards

import (
	"fmt"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// Format is a stored scoring board.
type Format string

// The three scoring boards the research lane publishes.
const (
	PPR      Format = "ppr"
	Half     Format = "half"
	Standard Format = "std"
)

// Formats is every stored board, the order a warm-up loads them in.
func Formats() []Format { return []Format{PPR, Half, Standard} }

// Reception points a custom rule must reach to read as PPR or half.
const (
	pprReceptionFrom  = 0.75
	halfReceptionFrom = 0.25
	receptionStat     = "rec"
	receptionRule     = "points_per_reception"
)

// FormatFor is the board a league's scoring drafts from. TE premium has
// no board of its own yet, so it reads the PPR board and the basis says
// PPR; a custom rule reads the nearest of the three by its points per
// reception.
func FormatFor(s apitypes.Scoring) Format {
	if s.Preset != nil {
		switch *s.Preset {
		case apitypes.ScoringPresetHalfPpr:
			return Half
		case apitypes.ScoringPresetStandard:
			return Standard
		default:
			return PPR
		}
	}
	if s.Custom != nil {
		rec := (*s.Custom)[receptionStat]
		// ScoringRules' name for it, as an attached league saves it.
		if v, ok := (*s.Custom)[receptionRule]; ok {
			rec = v
		}
		switch {
		case rec >= pprReceptionFrom:
			return PPR
		case rec >= halfReceptionFrom:
			return Half
		}
		return Standard
	}
	return PPR
}

// Words is how a sentence names the board's points: "PPR".
func (f Format) Words() string {
	switch f {
	case Half:
		return "half PPR"
	case Standard:
		return "standard"
	default:
		return "PPR"
	}
}

// Board is the contract's name for the stored board: "half_ppr".
func (f Format) Board() apitypes.BoardFormat {
	switch f {
	case Half:
		return apitypes.BoardFormatHalfPpr
	case Standard:
		return apitypes.BoardFormatStandard
	default:
		return apitypes.BoardFormatPpr
	}
}

// Player is one row of a stored board.
type Player struct {
	ID       string
	Name     string
	Position draft.Position
	Team     string
	Headshot string
	// ADP is where drafters take him, nil when no source has him.
	ADP *float64
	// Points is his projected season, nil for a position the board ships
	// in market order (kickers and defenses): no projection, never zero.
	Points *float64
	// Bye is his team's bye week, 0 when the schedule has none.
	Bye int
	// Range is his season's floor, median and ceiling, nil with no
	// projection.
	Range *Range
}

// Range is a season's range of outcomes on the stored board.
type Range struct {
	Floor   float64
	Median  float64
	Ceiling float64
}

// Raw is one scoring board as stored, players in pool order: ADP
// ascending, unpriced last, ties by id.
type Raw struct {
	Format  Format
	Season  int
	Source  string
	AsOf    time.Time
	Players []Player
}

// Board is a stored board valued for one league: points over replacement
// for every projected player at a position the league starts.
type Board struct {
	Raw *Raw
	// Values is points over replacement, absent where the league starts
	// nobody at his position or the board has no projection for him.
	Values map[string]float64
	// PositionRanks is his place at his position by points over
	// replacement, then by ADP for a market-order position.
	PositionRanks map[string]int
	// RankedFor is set when the league's scoring has no board of its own
	// (see the function RankedFor); the basis then names the board used.
	RankedFor string
	byID      map[string]int
	teams     int
}

// For values raw under a league of teams starting slots.
func For(raw *Raw, teams int, slots []draft.SlotConfig) (Board, error) {
	values, err := valueOverReplacement(raw.Players, teams, slots)
	if err != nil {
		return Board{}, err
	}
	b := Board{Raw: raw, Values: values, byID: make(map[string]int, len(raw.Players)), teams: teams}
	for i, p := range raw.Players {
		b.byID[p.ID] = i
	}
	b.PositionRanks = positionRanks(raw.Players, values)
	return b, nil
}

// Player is one player by id.
func (b Board) Player(id string) (Player, bool) {
	i, ok := b.byID[id]
	if !ok {
		return Player{}, false
	}
	return b.Raw.Players[i], true
}

// Pool is the engine's pool: every player, in the order drafters take
// them, which is the order the bots and the clock read.
func (b Board) Pool() []draft.PoolEntry {
	out := make([]draft.PoolEntry, len(b.Raw.Players))
	for i, p := range b.Raw.Players {
		out[i] = draft.PoolEntry{PlayerID: p.ID, Position: p.Position}
	}
	return out
}

// Points is projected points by player, projected players only.
func (b Board) Points() map[string]float64 {
	out := make(map[string]float64, len(b.Raw.Players))
	for _, p := range b.Raw.Players {
		if p.Points != nil {
			out[p.ID] = *p.Points
		}
	}
	return out
}

// ADPs is ADP by player, priced players only.
func (b Board) ADPs() map[string]float64 {
	out := make(map[string]float64, len(b.Raw.Players))
	for _, p := range b.Raw.Players {
		if p.ADP != nil {
			out[p.ID] = *p.ADP
		}
	}
	return out
}

// Teams is NFL team by player.
func (b Board) Teams() map[string]string {
	out := make(map[string]string, len(b.Raw.Players))
	for _, p := range b.Raw.Players {
		out[p.ID] = p.Team
	}
	return out
}

// Byes is bye week by NFL team.
func (b Board) Byes() map[string]int {
	out := map[string]int{}
	for _, p := range b.Raw.Players {
		if p.Bye > 0 {
			out[p.Team] = p.Bye
		}
	}
	return out
}

// Basis is the sentence that names what the numbers are: whose points,
// over replacement for what league.
func (b Board) Basis() string {
	ranked := ""
	if b.RankedFor != "" {
		ranked = fmt.Sprintf("%s is ranked on our %s board. ", b.RankedFor, b.Raw.Format.Words())
	}
	return fmt.Sprintf("%sPoints are our %d %s projections, over replacement for %d teams on this roster. Kickers and defenses carry no projection and sit where drafters take them.",
		ranked, b.Raw.Season, b.Raw.Format.Words(), b.teams)
}

// RankedFor names a league's scoring when no board of its own exists
// yet and the room ranks it on the nearest stored board: "TE premium",
// "Your custom scoring". Empty when the board is the scoring's own.
func RankedFor(s apitypes.Scoring) string {
	switch {
	case s.Custom != nil:
		return "Your custom scoring"
	case s.Preset != nil && *s.Preset == apitypes.ScoringPresetTePremium:
		return "TE premium"
	}
	return ""
}
