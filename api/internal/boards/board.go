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
	"strings"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/figurewords"
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

// FormatFor is the stored board a preset drafts from. TE premium has no
// board of its own yet, so it reads the PPR board and the basis says so.
// A league's own rules never read a stored board: CustomSource scores the
// stored board's candidates under them exactly.
func FormatFor(preset apitypes.ScoringPreset) Format {
	switch preset {
	case apitypes.ScoringPresetHalfPpr:
		return Half
	case apitypes.ScoringPresetStandard:
		return Standard
	default:
		return PPR
	}
}

// FormatForBoard is the stored board a sheet's format reads: the board of
// its scoring where there is one, else the PPR board (as FormatFor).
func FormatForBoard(f apitypes.BoardFormat) Format {
	switch f {
	case apitypes.BoardFormatHalfPpr:
		return FormatFor(apitypes.ScoringPresetHalfPpr)
	case apitypes.BoardFormatStandard:
		return FormatFor(apitypes.ScoringPresetStandard)
	default:
		return FormatFor(apitypes.ScoringPresetPpr)
	}
}

// FormatOfSource is the stored format a board source names
// (<prefix>_<format>_12), false for one that names none.
func FormatOfSource(source string) (Format, bool) {
	for _, f := range Formats() {
		if strings.Contains(source, "_"+string(f)+"_") {
			return f, true
		}
	}
	return "", false
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
	// Team is his club's code, "" for a free agent (Lane 123): no club,
	// so no bye, no game and no opponent; WireClub is how an answer
	// names it.
	Team string
	// Headshot is our copy of his headshot (faces.go, Lane 241), "" when
	// the season has none.
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
	// GamePoints is his points for one more club game after the run's
	// counted weeks (published_boards.game_points, Lane 96): the week a
	// league's title week runs past the run's last is valued at it. Nil
	// preseason and on a run older than the column.
	GamePoints *float64
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
	Format Format
	Season int
	// Source is the stored preseason board the format names
	// (<prefix>_<format>_12), the boards service's source for a custom one.
	Source string
	// AsOf is when the points were made: the published run's refresh in
	// season, else the stored board generation.
	AsOf time.Time
	// Order is what the points rank: the published run's order, preseason
	// for the stored preseason board and a custom board.
	Order Order
	// Run is the published run the points come from
	// (research.published_boards), empty when they come from the stored
	// preseason board itself.
	Run string
	// FromWeek is the first week the published run's rest-of-season
	// points cover (research.published_boards.from_week), 0 when the run
	// does not say or the points are the preseason board's.
	FromWeek int
	Players  []Player
	// Custom is set when the points are a league's own rules applied to
	// the stored board's candidates (CustomSource), not a stored board.
	Custom bool
}

// Order is which order ranks a board's players, as
// research.published_boards names it.
type Order string

// The two orders (in-season tools spec §3).
const (
	OrderPreseason    Order = "preseason"
	OrderRestOfSeason Order = "rest_of_season"
)

// Valid is true for an order the board knows how to say.
func (o Order) Valid() bool { return o == OrderPreseason || o == OrderRestOfSeason }

// Board is a stored board valued for one league: points over replacement
// for every projected player at a position the league starts.
type Board struct {
	Raw *Raw
	// Order is which order ranks the board and Refreshed when that order
	// was made, both the Raw's: from week 7 the published run's
	// rest-of-season order and refresh, else preseason and the stored
	// board's as_of.
	Order     Order
	Refreshed time.Time
	// FromWeek is the Raw's: the first week a rest-of-season order covers,
	// 0 when not known.
	FromWeek int
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
	// slots is the league's starting slots the board was valued for, so a
	// rescaled board (Rescaled) is valued for the same league.
	slots []draft.SlotConfig
}

// For values raw under a league of teams starting slots.
func For(raw *Raw, teams int, slots []draft.SlotConfig) (Board, error) {
	values, err := valueOverReplacement(raw.Players, teams, slots)
	if err != nil {
		return Board{}, err
	}
	order := raw.Order
	if order == "" {
		// A Raw built by hand (tests, the sim) names no order: it is a
		// preseason board. Every source sets its own.
		order = OrderPreseason
	}
	b := Board{Raw: raw, Order: order, Refreshed: raw.AsOf, FromWeek: raw.FromWeek, Values: values, byID: make(map[string]int, len(raw.Players)), teams: teams, slots: slots}
	for i, p := range raw.Players {
		b.byID[p.ID] = i
	}
	b.PositionRanks = positionRanks(raw.Players, values)
	return b, nil
}

// Identity is what a board's figures follow from: its points (the Raw,
// one pointer per load, so a new run is a new identity), the league it is
// valued for and the order it says. Two boards of one identity are the
// same board, so a figure built from one serves the other (Lane 112).
type Identity struct {
	raw       *Raw
	teams     int
	slots     string
	rankedFor string
	order     Order
	refreshed int64
	fromWeek  int
}

// Identity is the board's identity.
func (b Board) Identity() Identity {
	return Identity{raw: b.Raw, teams: b.teams, slots: SlotKey(b.slots), rankedFor: b.RankedFor, order: b.Order,
		refreshed: b.Refreshed.UnixNano(), fromWeek: b.FromWeek}
}

// SlotKey is starting slots as one comparable string: each slot and its
// count, in order.
func SlotKey(slots []draft.SlotConfig) string {
	var sb strings.Builder
	for _, s := range slots {
		fmt.Fprintf(&sb, "%s:%d;", s.Slot, s.Count)
	}
	return sb.String()
}

// Rescaled is the board with each player's points given by points (a
// player it does not name keeps his), valued again for the same league:
// a new Raw and a new Board, the receiver untouched. Order, Refreshed,
// FromWeek and RankedFor are the receiver's.
func (b Board) Rescaled(points map[string]float64) (Board, error) {
	if b.Raw == nil {
		return Board{}, fmt.Errorf("boards: no board to rescale")
	}
	raw := *b.Raw
	raw.Players = make([]Player, len(b.Raw.Players))
	for i, p := range b.Raw.Players {
		if v, ok := points[p.ID]; ok && p.Points != nil {
			p.Points = &v
		}
		raw.Players[i] = p
	}
	out, err := For(&raw, b.teams, b.slots)
	if err != nil {
		return Board{}, err
	}
	out.Order, out.Refreshed, out.FromWeek, out.RankedFor = b.Order, b.Refreshed, b.FromWeek, b.RankedFor
	return out, nil
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

// WireClub is a club as every answer carries it: his code, or for a free
// agent (Team "", the store's NULL, Lane 123) the site's one word for the
// cell (figurewords FreeAgentClub, "FA"). The wire's team stays a string,
// so a web that predates the rule draws the cell and reads it as before.
func WireClub(team string) string {
	if team == "" {
		return figurewords.Table.FreeAgentClub
	}
	return team
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

// CustomBasis says what a board for a league's own rules is built on, and
// no more: the 21 rules we score (a rule the import left out is named as
// left out on the setup page), the stored board whose players and draft
// positions it takes, and kickers and defenses in draft order.
func CustomBasis(f Format) string {
	return fmt.Sprintf("Built under the 21 scoring rules you set, on our %s board's players and draft positions "+
		"(the board closest to your points per catch). Kickers and defenses rank in draft order.", f.Words())
}

// Basis is the sentence that names what the numbers are: whose points,
// over replacement for what league.
func (b Board) Basis() string {
	tail := fmt.Sprintf("over replacement for %d teams on this roster. Kickers and defenses carry no projection and rank in draft order.", b.teams)
	if b.Raw.Custom {
		return fmt.Sprintf("Your league's scoring. Points are our %d projections over replacement for %d teams on this roster. "+
			"%s", b.Raw.Season, b.teams, CustomBasis(b.Raw.Format))
	}
	ranked := ""
	if b.RankedFor != "" {
		ranked = fmt.Sprintf("%s is ranked on our %s board. ", b.RankedFor, b.Raw.Format.Words())
	}
	if b.Order == OrderRestOfSeason {
		return fmt.Sprintf("%sPoints are our %d %s projections for the rest of the season, refreshed %s, %s",
			ranked, b.Raw.Season, b.Raw.Format.Words(), b.Refreshed.UTC().Format("January 2"), tail)
	}
	return fmt.Sprintf("%sPoints are our %d %s projections, %s", ranked, b.Raw.Season, b.Raw.Format.Words(), tail)
}

// RankedFor names a preset with no board of its own, which the room
// ranks on the nearest stored board: "TE premium". Empty when the board
// is the scoring's own, a league's own rules included.
func RankedFor(s apitypes.Scoring) string {
	if s.Preset != nil && *s.Preset == apitypes.ScoringPresetTePremium {
		return "TE premium"
	}
	return ""
}
