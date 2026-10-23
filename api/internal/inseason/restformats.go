package inseason

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// The player page's rest of season in every format the run carries
// (Lane 86, review H3): the every-format table, the tier box, the card's
// tile and the read's figure all take the read's figures once it answers,
// each from its format's board re-valued by LiveBoard at the read's clock,
// so one player has one rest-of-season total on the page.

// RunFormat is one format the run carries and the league it is valued
// for (research/nightly/config.py RUN_FORMATS): twelve teams.
type RunFormat struct {
	Format   apitypes.BoardFormat
	Settings apitypes.LeagueSettings
}

// RunFormats is the run's formats in its order: PPR, half PPR and
// standard on the standard lineup, PPR on the superflex lineup.
func RunFormats() []RunFormat {
	league := func(preset apitypes.ScoringPreset, lineup apitypes.Lineup) apitypes.LeagueSettings {
		s := PublicSettings()
		s.Scoring, s.Lineup = apitypes.Scoring{Preset: &preset}, lineup
		return s
	}
	return []RunFormat{
		{apitypes.BoardFormatPpr, league(apitypes.ScoringPresetPpr, apitypes.LineupStandard)},
		{apitypes.BoardFormatHalfPpr, league(apitypes.ScoringPresetHalfPpr, apitypes.LineupStandard)},
		{apitypes.BoardFormatStandard, league(apitypes.ScoringPresetStandard, apitypes.LineupStandard)},
		{apitypes.BoardFormatSuperflex, league(apitypes.ScoringPresetPpr, apitypes.LineupSuperflex)},
	}
}

// liveFormat is one run format's board at the read's clock.
type liveFormat struct {
	format apitypes.BoardFormat
	board  boards.Board
	rest   RestNow
}

// liveRunBoards is every run format's board at now, the first PPR's (the
// read with no league's board). lives keeps each across requests (nil
// builds them afresh).
func liveRunBoards(ctx context.Context, src BoardSource, games []boards.TeamWeek, now time.Time, lives *LiveBoards) ([]liveFormat, error) {
	formats := RunFormats()
	out := make([]liveFormat, 0, len(formats))
	for _, f := range formats {
		b, err := src.For(ctx, f.Settings)
		if err != nil {
			return nil, fmt.Errorf("inseason: the %s board: %w", f.Format, err)
		}
		live, rest, err := lives.At(b, games, StandardHorizon.Reaching(b.FromWeek), now)
		if err != nil {
			return nil, fmt.Errorf("inseason: the %s board at the read's clock: %w", f.Format, err)
		}
		out = append(out, liveFormat{format: f.Format, board: live, rest: rest})
	}
	return out, nil
}

// maxTierMates bounds ?tier=: a tier box lists at most this many.
const maxTierMates = 24

// Field names and the words for them.
const (
	fieldTier       = "tier"
	fieldTierNext   = "tier_next"
	fieldTierFormat = "tier_format"
	tierWords       = "Name 1 to 24 players, separated by commas"
	tierNextWords   = "Name one player"
	tierFormatWords = "Pick a format the board carries"
)

// tierQuery is the tier box the read is asked for: its players, the next
// tier's first and its format. No ids, no tier.
type tierQuery struct {
	format apitypes.BoardFormat
	ids    []string
	next   string
}

// parseTierQuery reads ?tier=, ?tier_next= and ?tier_format=, or names
// each field it refuses.
func parseTierQuery(r *http.Request) (tierQuery, map[string]string) {
	values := r.URL.Query()
	q := tierQuery{format: apitypes.BoardFormatPpr, next: values.Get(fieldTierNext)}
	bad := map[string]string{}
	if raw := values.Get(fieldTier); raw != "" {
		q.ids = strings.Split(raw, ",")
		if len(q.ids) > maxTierMates {
			bad[fieldTier] = tierWords
		}
		for _, id := range q.ids {
			if id == "" || len(id) > maxPlayerParam {
				bad[fieldTier] = tierWords
			}
		}
	}
	if len(q.next) > maxPlayerParam {
		bad[fieldTierNext] = tierNextWords
	}
	if raw := values.Get(fieldTierFormat); raw != "" {
		q.format = apitypes.BoardFormat(raw)
		if _, ok := liveFormatIndex(q.format); !ok {
			bad[fieldTierFormat] = tierFormatWords
		}
	}
	return q, bad
}

// liveFormatIndex is a run format's place in RunFormats.
func liveFormatIndex(f apitypes.BoardFormat) (int, bool) {
	for i, rf := range RunFormats() {
		if rf.Format == f {
			return i, true
		}
	}
	return 0, false
}

// fillRest puts his rest of season at the read's clock on the read: every
// run format's total and Over repl., the week it starts from, and the
// tier asked, each of its players ranked by ranks, the read's own
// position ranks (the map its line.position_rank is read from), so the
// tier box and the card's head say one number (Lane 162, D02). Nothing
// off the rest-of-season order.
func fillRest(out *apitypes.PlayerWeek, lives []liveFormat, bp boards.Player, q tierQuery, ranks map[string]int) {
	figures := []apitypes.RestOfSeasonFigure{}
	for _, live := range lives {
		p, ok := live.board.Player(bp.ID)
		if !ok || !carriesPerGame(live.board) || p.Points == nil {
			continue
		}
		fig := apitypes.RestOfSeasonFigure{Format: live.format, Points: roundTenth(*p.Points)}
		if v, valued := live.board.Values[bp.ID]; valued {
			r := roundTenth(v)
			fig.PointsOverReplacement = &r
		}
		figures = append(figures, fig)
	}
	if len(figures) == 0 {
		return
	}
	out.RestOfSeason = &figures
	if from := lives[0].rest.From(bp.Team); from > 0 {
		out.RestFromWeek = &from
	}
	if i, ok := liveFormatIndex(q.format); ok && len(q.ids) > 0 && i < len(lives) {
		out.Tier = tierOf(lives[i], q, ranks)
	}
}

// pointsOf is a player's live points to a tenth, nil without a projection.
func pointsOf(b boards.Board, id string) *float64 {
	p, ok := b.Player(id)
	if !ok || p.Points == nil {
		return nil
	}
	v := roundTenth(*p.Points)
	return &v
}

// tierOf is the tier box at the read's clock: each player's points, his
// rank among the players who play (ranks, none on a season-long list) and
// the week his points count from (Lane 162, D02 and D03), the drop from
// the last to the next tier's first, and the board's first week.
func tierOf(live liveFormat, q tierQuery, ranks map[string]int) *apitypes.RestOfSeasonTier {
	tier := apitypes.RestOfSeasonTier{Format: live.format, Mates: make([]apitypes.TierMate, len(q.ids)), Partial: live.rest.Partial}
	for i, id := range q.ids {
		tier.Mates[i] = tierMate(live, id, ranks)
	}
	if live.rest.FromWeek > 0 {
		from := live.rest.FromWeek
		tier.FromWeek = &from
	}
	last, next := pointsOf(live.board, q.ids[len(q.ids)-1]), pointsOf(live.board, q.next)
	if q.next != "" && last != nil && next != nil {
		d := roundTenth(*last - *next)
		tier.Drop = &d
	}
	return &tier
}

// tierMate is one tier box player at the read's clock: his points, his
// rank as the read ranks him and the week his points count from; the rank
// and the week nil for a player off the board.
func tierMate(live liveFormat, id string, ranks map[string]int) apitypes.TierMate {
	mate := apitypes.TierMate{BoardId: id, Points: pointsOf(live.board, id)}
	p, ok := live.board.Player(id)
	if !ok {
		return mate
	}
	if rank := ranks[id]; rank > 0 {
		mate.PositionRank = &rank
	}
	if from := live.rest.From(p.Team); from > 0 {
		mate.FromWeek = &from
	}
	return mate
}
