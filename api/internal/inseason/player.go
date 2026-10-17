package inseason

import (
	"net/http"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
	"github.com/jhunthrop/commish/api/internal/httpx"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
	"github.com/jhunthrop/commish/api/internal/scoring"
)

// The player page's reads (Lane 66h): one player's Lineup row, in PPR
// with no league, in the league's scoring with one, and with a league the
// one verb its screens would give him.

// Field names and the drafter's words for the player reads.
const (
	teamWords       = "Name a club with a game on this season's schedule"
	cardWords       = "Name a quarterback, running back, receiver or tight end"
	playerPathParam = "player"
)

// cardPositions are the positions a player page shows: kickers and
// defenses have none (founder ruling 2026-10-17).
var cardPositions = map[draft.Position]bool{draft.QB: true, draft.RB: true, draft.WR: true, draft.TE: true}

// pprPreset is the scoring a read with no league is in.
const pprPreset = apitypes.ScoringPresetPpr

// playerParam is the path's board id, false when empty or too long.
func playerParam(r *http.Request) (string, bool) {
	id := r.PathValue(playerPathParam)
	return id, id != "" && len(id) <= maxPlayerParam
}

// plays is whether the club has a game on the season's schedule.
func plays(games []boards.TeamWeek, team string) bool {
	for _, g := range games {
		if g.Team == team {
			return true
		}
	}
	return false
}

// publicLine is one player's row with no league: his facts for the week,
// in PPR, and the week's projection read in PPR.
func publicLine(d Data, projection boards.WeekProjection, boardID string, position draft.Position, team string, week int, now time.Time) apitypes.PlayerLine {
	season := NewSeason(d, RulesOf(scoring.PresetRules(pprPreset)), week, now)
	facts := season.For(Player{BoardID: boardID, Team: team, Position: position})
	id := boardID
	line := apitypes.PlayerLine{Player: apitypes.LeaguePlayer{BoardId: &id, Position: string(position), Team: team},
		Facts: wireFacts(facts, nil)}
	if facts.Opponent != "" {
		if p, ok := projection.Player(boardID, string(position), team); ok {
			v := roundCents(p.For(pprPreset))
			line.WeekProjection = &v
		}
		if d, ok := projection.Delta(boardID, string(position), team, pprPreset); ok {
			v := roundCents(d)
			line.ProjectionDelta = &v
		}
	}
	line.OppRank, line.SeasonAvg, line.LastPoints = evidence(facts)
	return line
}

// readsOf is when a projection and the one before it were captured, each
// nil with none.
func readsOf(p boards.WeekProjection) (read, previous *time.Time) {
	if !p.ReadAt.IsZero() {
		at := p.ReadAt
		read = &at
	}
	if p.Previous != nil && !p.Previous.ReadAt.IsZero() {
		at := p.Previous.ReadAt
		previous = &at
	}
	return read, previous
}

// playerWeek answers GET /players/{player}/week: anyone may read it.
func (s *Service) playerWeek(w http.ResponseWriter, r *http.Request) {
	id, ok := playerParam(r)
	if !ok {
		httpx.WriteInvalid(w, r, map[string]string{fieldPlayer: playerWords})
		return
	}
	position := draft.Position(r.URL.Query().Get(fieldPosition))
	if !cardPositions[position] {
		httpx.WriteInvalid(w, r, map[string]string{fieldPosition: cardWords})
		return
	}
	team := r.URL.Query().Get(fieldTeam)
	ctx := r.Context()
	data, err := s.Facts.Data(ctx, s.Season)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "inseason: player week", err)
		return
	}
	if !plays(data.Games, team) {
		httpx.WriteInvalid(w, r, map[string]string{fieldTeam: teamWords})
		return
	}
	week := nextWeek(data.Games)
	projection := s.projection(ctx, s.Season, week)
	read, previous := readsOf(projection)
	httpx.WriteOK(w, r, http.StatusOK, apitypes.PlayerWeek{Week: week,
		Line:              publicLine(data, projection, id, position, team, week, s.Now()),
		ProjectionScoring: apitypes.ProjectionScoring{Format: apitypes.ProjectionScoringFormatPpr, LeagueOwn: false},
		ProjectionReadAt:  read, ProjectionPreviousReadAt: previous})
}

// leaguePlayerWeek answers GET /leagues/attached/{id}/players/{player}.
func (s *Service) leaguePlayerWeek(w http.ResponseWriter, r *http.Request) {
	id, ok := playerParam(r)
	if !ok {
		httpx.WriteInvalid(w, r, map[string]string{fieldPlayer: playerWords})
		return
	}
	a, ok := s.advisorFor(w, r)
	if !ok {
		return
	}
	bp, placed := a.Board.Player(id)
	if !placed || !cardPositions[bp.Position] {
		httpx.WriteNotFound(w, r)
		return
	}
	out, ok := a.PlayerWeek(bp)
	if !ok {
		s.answer(w, r, out, false)
		return
	}
	if out.Verb != nil && (out.Verb.Kind == apitypes.PlayerVerbKindWaivers || out.Verb.Kind == apitypes.PlayerVerbKindClaim) {
		out.Verb = s.claimVerb(r, a, bp, *out.Verb)
	}
	s.answer(w, r, out, true)
}

// claimVerb is the free player's verb as the claim moves say: the claim
// when one can be made from our screen for him, else the platform's page.
// A failed check fails closed, as the Waivers screen's does.
func (s *Service) claimVerb(r *http.Request, a *advisor, bp boards.Player, verb apitypes.PlayerVerb) *apitypes.PlayerVerb {
	verb.Kind = apitypes.PlayerVerbKindWaivers
	if s.Moves == nil {
		return &verb
	}
	moves, err := s.Moves.ClaimMove(r.Context(), auth.AccountID(r), a.Snap.Ref.Host)
	if err != nil {
		s.Log.Warn("inseason: claim moves", "err", err)
		return &verb
	}
	verb.Note = moves.Note
	if moves.Claim == apitypes.WaiverMovesClaimAvailable && a.hostIDOfAdd(bp) != "" {
		verb.Kind = apitypes.PlayerVerbKindClaim
	}
	return &verb
}

// PlayerWeek is one placed player's Lineup row in the league's scoring and
// the verb the league's screens give him: false when the drafter's team
// is not in the read.
func (a *advisor) PlayerWeek(bp boards.Player) (apitypes.PlayerWeek, bool) {
	team, ok := a.Snap.TeamByRoster(a.Me)
	if !ok {
		return apitypes.PlayerWeek{}, false
	}
	read, previous := a.projectionReadAt(), a.projectionPreviousReadAt()
	out := apitypes.PlayerWeek{Week: a.Snap.Week, ProjectionScoring: projectionScoring(a.settings, a.preset),
		ProjectionReadAt: read, ProjectionPreviousReadAt: previous}
	holder, held := a.HeldBy[bp.ID]
	switch {
	case held && holder == a.Me:
		hostID := a.hostIDOf(bp.ID)
		out.Line = a.build(hostID, a.Player(hostID), a.side(a.Me)).line
		out.Verb = &apitypes.PlayerVerb{Kind: a.lineupVerb(team, hostID)}
	case held:
		hostID := a.hostIDOf(bp.ID)
		out.Line = a.build(hostID, a.Player(hostID), a.side(holder)).line
		verb := apitypes.PlayerVerb{Kind: apitypes.PlayerVerbKindTrade}
		if t, ok := a.Snap.TeamByRoster(holder); ok && t.Name != "" {
			name := t.Name
			verb.Holder = &name
		}
		out.Verb = &verb
	default:
		id := bp.ID
		lp := apitypes.LeaguePlayer{HostId: a.hostIDOfAdd(bp), BoardId: &id, Name: bp.Name, Position: string(bp.Position), Team: bp.Team}
		out.Line = a.build(bp.ID, lp, nil).line
		href, _ := a.host(WaiversPage)
		verb := apitypes.PlayerVerb{Kind: apitypes.PlayerVerbKindWaivers}
		if href != "" {
			verb.HostUrl = &href
		}
		out.Verb = &verb
	}
	return out, true
}

// lineupVerb is start when our lineup starts him and the platform's does
// not, lineup otherwise.
func (a *advisor) lineupVerb(team leaguesync.Team, hostID string) apitypes.PlayerVerbKind {
	advice, ok := a.Lineup()
	if !ok {
		return apitypes.PlayerVerbKindLineup
	}
	for _, slot := range advice.Slots {
		if slot.Ours.Player.HostId != hostID {
			continue
		}
		for _, s := range team.Starters {
			if s == hostID {
				return apitypes.PlayerVerbKindLineup
			}
		}
		return apitypes.PlayerVerbKindStart
	}
	return apitypes.PlayerVerbKindLineup
}
