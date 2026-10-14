// Package draftroom is what the solo room and the lobby share: the board
// valued for a league, the wire views of a room, the card, the report,
// and the stand-in's pick rule (queue, then sheet, then board).
package draftroom

import (
	"context"
	"fmt"
	"math"
	"strings"
	"sync"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/mock"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// RawLoader is boards.Cache: one stored board per scoring format.
type RawLoader interface {
	Load(ctx context.Context, f boards.Format) (*boards.Raw, error)
}

// Boards values a stored board for a league and keeps each league shape's
// answer for as long as the stored board it was valued from is current.
type Boards struct {
	Raw RawLoader
	// Schedule is the research schedule the board reads byes from, which
	// also answers a season's first kickoff (season.Sale).
	Schedule *boards.PGSource
	// Custom scores a league's own rules exactly (the boards service);
	// nil answers boards.ErrCustomUnavailable for them.
	Custom *boards.CustomSource

	mu     sync.Mutex
	valued map[shapeKey]boards.Board
}

type shapeKey struct {
	raw    *boards.Raw
	teams  int
	slots  string
	ranked string
}

// maxShapes bounds the valued boards kept; past it the map starts over.
const maxShapes = 256

// For is the board a league drafts from, valued for its roster.
func (b *Boards) For(ctx context.Context, s apitypes.LeagueSettings) (boards.Board, error) {
	slots, err := mock.SlotConfig(s)
	if err != nil {
		return boards.Board{}, err
	}
	raw, err := b.raw(ctx, s, slots)
	if err != nil {
		return boards.Board{}, err
	}
	key := shapeKey{raw: raw, teams: s.Teams, slots: slotKey(slots), ranked: boards.RankedFor(s.Scoring)}
	b.mu.Lock()
	if v, ok := b.valued[key]; ok {
		b.mu.Unlock()
		return v, nil
	}
	b.mu.Unlock()
	v, err := boards.For(raw, s.Teams, slots)
	v.RankedFor = boards.RankedFor(s.Scoring)
	if err != nil {
		return boards.Board{}, fmt.Errorf("draftroom: value the board: %w", err)
	}
	b.mu.Lock()
	if b.valued == nil || len(b.valued) >= maxShapes {
		b.valued = map[shapeKey]boards.Board{}
	}
	b.valued[key] = v
	b.mu.Unlock()
	return v, nil
}

// raw is the league's board before it is valued: a league's own rules
// scored exactly, a preset's stored board.
func (b *Boards) raw(ctx context.Context, s apitypes.LeagueSettings, slots []draft.SlotConfig) (*boards.Raw, error) {
	if s.Scoring.Custom != nil {
		// Rules that are exactly a stored board's read it: the same board,
		// bit for bit, without the boards service in the path.
		if preset, ok := scoring.StoredPreset(*s.Scoring.Custom); ok {
			return b.Raw.Load(ctx, boards.FormatFor(preset))
		}
		return b.Custom.Load(ctx, *s.Scoring.Custom, s.Teams, slots)
	}
	preset := apitypes.ScoringPresetPpr
	if s.Scoring.Preset != nil {
		preset = *s.Scoring.Preset
	}
	return b.Raw.Load(ctx, boards.FormatFor(preset))
}

func slotKey(slots []draft.SlotConfig) string {
	var sb strings.Builder
	for _, s := range slots {
		fmt.Fprintf(&sb, "%s:%d;", s.Slot, s.Count)
	}
	return sb.String()
}

// round2 keeps two decimals on the wire: every page prints one.
func round2(v float64) float64 { return math.Round(v*100) / 100 }

func round2p(v *float64) *float64 {
	if v == nil {
		return nil
	}
	r := round2(*v)
	return &r
}

// BoardView is the board on the wire; keep, when set, limits it to the
// players a view names.
func BoardView(b boards.Board, keep map[string]bool) apitypes.RoomBoard {
	out := apitypes.RoomBoard{
		Format: apitypes.RoomBoardFormat(b.Raw.Format), Season: b.Raw.Season, AsOf: b.Raw.AsOf, Basis: b.Basis(),
		Players: make([]apitypes.BoardPlayer, 0, len(b.Raw.Players)),
	}
	for _, p := range b.Raw.Players {
		if keep != nil && !keep[p.ID] {
			continue
		}
		out.Players = append(out.Players, PlayerView(b, p))
	}
	return out
}

// PlayerView is one player on the wire.
func PlayerView(b boards.Board, p boards.Player) apitypes.BoardPlayer {
	v := apitypes.BoardPlayer{
		Id: p.ID, Name: p.Name, Position: apitypes.PlayerPosition(p.Position), Team: p.Team, Headshot: p.Headshot,
		Adp: round2p(p.ADP), Points: round2p(p.Points), PositionRank: b.PositionRanks[p.ID],
	}
	if vor, ok := b.Values[p.ID]; ok {
		r := round2(vor)
		v.Vor = &r
	}
	if p.Bye > 0 {
		bye := p.Bye
		v.Bye = &bye
	}
	return v
}
