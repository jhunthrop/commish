package inseason

import (
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/jsmath"
)

// The week's game facts in the contract's words (Lane 66a): the game's
// expected score and margin, the roof and the kickoff forecast, each a
// fact with its read time. The rows of the three screens carry them in
// WeekFacts, and GET /games/week carries every club's for the Matchup
// screen and the player pages.

// halfPoints is how the figures are said: to the nearest half point, as
// the books quote them (the capture's median of an even count of books
// can fall on a quarter).
func halfPoints(n float64) float64 { return jsmath.Round(n*2) / 2 }

// FiguresStaleAfter is how old the hourly capture's figures may be at
// the game's instant (the round 4 preregistration §2.10: five missed
// hourly captures). Older, they give way to the game table's weekly read.
const FiguresStaleAfter = 6 * time.Hour

// figuresAt is the figures the screens say at now for a game kicking off
// at kickoff: the capture's read while it is no more than
// FiguresStaleAfter before min(now, kickoff), else the game table's read,
// else none (no capture read at all is the same as a stale one). A read
// exactly FiguresStaleAfter old still stands.
func figuresAt(g boards.GameFact, now, kickoff time.Time) boards.GameFact {
	instant := now
	if !kickoff.IsZero() && kickoff.Before(now) {
		instant = kickoff
	}
	if g.Figures == nil || instant.Sub(g.Figures.ReadAt) > FiguresStaleAfter {
		g.Figures = g.GameTableFigures
	}
	return g
}

// conditions is one club-week's game facts as the contract carries them.
type conditions struct {
	total   *apitypes.GameTotal
	spread  *apitypes.GameSpread
	roof    *apitypes.GameRoof
	weather *apitypes.KickoffWeather
}

func conditionsOf(g boards.GameFact) conditions {
	var c conditions
	if f := g.Figures; f != nil {
		c.total = &apitypes.GameTotal{Points: halfPoints(f.Total), TeamPoints: halfPoints(f.TeamPoints), ReadAt: f.ReadAt}
		margin := halfPoints(math.Abs(f.Spread))
		side := apitypes.GameSpreadSideEven
		switch {
		case margin == 0:
		case f.Spread > 0:
			side = apitypes.GameSpreadSideWin
		default:
			side = apitypes.GameSpreadSideLose
		}
		c.spread = &apitypes.GameSpread{Side: side, Points: margin, ReadAt: f.ReadAt}
	}
	if v := g.Venue; v != nil {
		c.roof = &apitypes.GameRoof{Kind: apitypes.GameRoofKind(v.Roof), Abroad: v.Abroad}
	}
	// A dome or a venue abroad says so through the roof and carries no
	// forecast, whatever an older read held.
	if w := g.Forecast; w != nil && (c.roof == nil || (c.roof.Kind != apitypes.GameRoofKindDome && !c.roof.Abroad)) {
		c.weather = &apitypes.KickoffWeather{TemperatureF: w.TemperatureF, WindMph: w.WindMph,
			PrecipitationChance: w.PrecipitationChance, ReadAt: w.ReadAt}
		if w.PrecipitationKind != nil {
			kind := apitypes.KickoffWeatherPrecipitationKind(*w.PrecipitationKind)
			c.weather.PrecipitationKind = &kind
		}
	}
	return c
}

// weekParam is ?week=, 0 when absent.
func weekParam(r *http.Request) (int, bool) {
	raw := r.URL.Query().Get("week")
	if raw == "" {
		return 0, true
	}
	week, err := strconv.Atoi(raw)
	if err != nil || week < 1 || week > maxWeek {
		return 0, false
	}
	return week, true
}

// maxWeek is the regular season's last week.
const maxWeek = 18

// nextWeek is the week of the earliest game not yet final, else the
// season's last week with a game, 0 without any.
func nextWeek(games []boards.TeamWeek) int {
	next, last := 0, 0
	for _, g := range games {
		if g.Week > last {
			last = g.Week
		}
		if !g.Final && (next == 0 || g.Week < next) {
			next = g.Week
		}
	}
	if next == 0 {
		return last
	}
	return next
}

// gameWeek is every club's game in the week, ordered by kickoff and club.
func gameWeek(d Data, season, week int, now time.Time) apitypes.GameWeek {
	out := apitypes.GameWeek{Season: season, Week: week, Games: []apitypes.ClubGame{}}
	for _, g := range d.Games {
		if g.Week != week {
			continue
		}
		c := conditionsOf(figuresAt(d.GameFacts[boards.ClubWeek{Week: week, Team: g.Team}], now, g.Kickoff))
		state := gameStateAt(g, now)
		out.Games = append(out.Games, apitypes.ClubGame{Team: g.Team, Opponent: g.Opponent, Home: g.Home,
			Kickoff: g.Kickoff, Played: g.Final, GameState: &state, GameTotal: c.total, Spread: c.spread, Roof: c.roof,
			Weather: c.weather})
	}
	sort.Slice(out.Games, func(i, j int) bool {
		a, b := out.Games[i], out.Games[j]
		if !a.Kickoff.Equal(b.Kickoff) {
			return a.Kickoff.Before(b.Kickoff)
		}
		return a.Team < b.Team
	})
	return out
}

// weekGames answers GET /games/week: anyone may read it, as the board is.
func (s *Service) weekGames(w http.ResponseWriter, r *http.Request) {
	week, ok := weekParam(r)
	if !ok {
		httpx.WriteError(w, r, http.StatusBadRequest, httpx.CodeInvalid, "Pick a week from 1 to 18", nil)
		return
	}
	data, err := s.Facts.Data(r.Context(), s.Season)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "inseason: game week", err)
		return
	}
	if week == 0 {
		week = nextWeek(data.Games)
	}
	httpx.WriteOK(w, r, http.StatusOK, gameWeek(data, s.Season, week, s.Now()))
}
