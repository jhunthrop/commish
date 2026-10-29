package inseason

import (
	"context"
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

// The path's name for the player reads.
const playerPathParam = "player"

// BoardSource values our board for a league's settings. *draftroom.Boards
// implements it; the public read values it for PublicSettings.
type BoardSource interface {
	For(ctx context.Context, s apitypes.LeagueSettings) (boards.Board, error)
}

// PublicSettings is the league a read with no league is valued in: twelve
// teams, the standard lineup, PPR.
func PublicSettings() apitypes.LeagueSettings {
	preset := pprPreset
	return apitypes.LeagueSettings{Teams: 12, Lineup: apitypes.LineupStandard, Scoring: apitypes.Scoring{Preset: &preset},
		Roster: apitypes.RosterCounts{Qb: 1, Rb: 2, Wr: 2, Te: 1, K: 1, Dst: 1, Bench: 6}}
}

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

// publicLine is one placed player's row with no league: his facts for the
// week, in PPR, the week's projection read in PPR, and his rest-of-season
// points a game on our board, as a league's rows carry them.
func publicLine(d Data, projection boards.WeekProjection, b boards.Board, rest RestNow, bp boards.Player, week int, now time.Time) apitypes.PlayerLine {
	season := publicSeason(d, week, now)
	return publicLineIn(season, publicRanks(season, b), projection, b, rest, bp)
}

// publicSeason is the season a read with no league is read in: PPR, at
// week and now.
func publicSeason(d Data, week int, now time.Time) *Season {
	return NewSeason(d, RulesOf(scoring.PresetRules(pprPreset)), week, now)
}

// publicRanks is each player's place among the players who play on b, the
// one a league's lines say (PlayingRanks, Lane 128): none while a
// season-long list holds him. The read's line and its tier box both read
// it (Lane 162).
func publicRanks(season *Season, b boards.Board) map[string]int {
	return PlayingRanks(b, publicListed(season))
}

// publicListed is whether a board player is on a season-long list with no
// league: the capture's designation alone, as the public order reads it.
func publicListed(season *Season) func(boards.Player) bool {
	return func(p boards.Player) bool {
		d := season.designation(Player{BoardID: p.ID, Team: p.Team, Position: p.Position})
		return d != nil && d.SeasonLong
	}
}

// publicLineIn is publicLine on a season and its ranks already read.
func publicLineIn(season *Season, ranks map[string]int, projection boards.WeekProjection, b boards.Board, rest RestNow, bp boards.Player) apitypes.PlayerLine {
	boardID, position, team := bp.ID, bp.Position, bp.Team
	facts := season.For(Player{BoardID: boardID, Team: team, Position: position})
	id := boardID
	line := apitypes.PlayerLine{Player: apitypes.LeaguePlayer{BoardId: &id, Name: bp.Name, Position: string(position), Team: boards.WireClub(team)},
		Facts: wireFacts(facts, nil), RestOfSeasonPerGame: RestOfSeasonPerGame(b, bp, rest.Left)}
	line.GameState = lineGameState(line, season.now)
	if rank, ok := ranks[boardID]; ok {
		line.PositionRank = &rank
	}
	if facts.Opponent != "" {
		// As of his kickoff once his game has kicked off (Lane 92, B27).
		projection := projectionAsOf(projection, facts)
		if p, ok := projection.Player(boardID, string(position), team); ok {
			// The tenth the card prints, rounded once here (Lane 66k rereview N1).
			v := roundTenth(roundCents(p.For(pprPreset)))
			line.WeekProjection = &v
		}
		if d, ok := projection.Delta(boardID, string(position), team, pprPreset); ok {
			v := roundTenth(d)
			line.ProjectionDelta = &v
		}
	}
	line.OppRank, line.SeasonAvg, line.LastPoints = evidence(facts)
	line.GamesPlayed = gamesPlayed(facts)
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
	tier, bad := parseTierQuery(r)
	if len(bad) > 0 {
		httpx.WriteInvalid(w, r, bad)
		return
	}
	ctx := r.Context()
	data, err := s.Facts.Data(ctx, s.Season)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "inseason: player week", err)
		return
	}
	now := s.Now()
	lives, err := liveRunBoards(ctx, s.Boards, data.Games, now, s.Lives)
	if err != nil {
		httpx.WriteInternal(w, r, s.Log, "inseason: player week board", err)
		return
	}
	// The read with no league is PPR's, the run's first format, at the read's clock.
	board, rest := lives[0].board, lives[0].rest
	// A kicker or defense has no page, so no read (founder ruling 2026-10-17).
	bp, placed := board.Player(id)
	if !placed || !cardPositions[bp.Position] {
		httpx.WriteNotFound(w, r)
		return
	}
	week := nextWeek(data.Games)
	projection := s.projection(ctx, s.Season, week)
	read, previous := readsOf(projection)
	season := publicSeason(data, week, now)
	ranks := publicRanks(season, board)
	out := apitypes.PlayerWeek{Week: week,
		Line:              publicLineIn(season, ranks, projection, board, rest, bp),
		ProjectionScoring: apitypes.ProjectionScoring{Format: apitypes.ProjectionScoringFormatPpr, LeagueOwn: false},
		ProjectionReadAt:  read, ProjectionPreviousReadAt: previous}
	listed := publicListed(season)
	fillRest(&out, lives, bp, tier, ranks, formatLists{others: listed, subject: listed(bp)})
	out.AfterBye = s.publicAfterBye(ctx, out, data, board, rest, bp, now)
	out.WeekRead = s.liveWeekRead(ctx, data.Games, bp, now)
	httpx.WriteOK(w, r, http.StatusOK, out)
}

// withRest puts his rest of season in every run format on a league's read
// (fillRest): the run's formats, not the league's own, as his page's
// every-format table and tier box are; the tier's players ranked by ranks,
// the league read's own. Each format's ranks count the other players as
// our order in that format does (publicListed at the public order's week:
// the league read's season when its week is that week, else the public
// one, built only then), and him by the league read's own rule, the
// platform's IR mark included, as his head is (Lane 227 fix round 1).
func (s *Service) withRest(ctx context.Context, out *apitypes.PlayerWeek, bp boards.Player, tier tierQuery, a *advisor) error {
	data, err := s.Facts.Data(ctx, s.Season)
	if err != nil {
		return err
	}
	now := s.Now()
	lives, err := liveRunBoards(ctx, s.Boards, data.Games, now, s.Lives)
	if err != nil {
		return err
	}
	season := a.season
	if week := nextWeek(data.Games); a.week != week {
		season = publicSeason(data, week, now)
	}
	lists := formatLists{others: publicListed(season), subject: a.seasonLong(bp, a.hostIDs())}
	fillRest(out, lives, bp, tier, a.playingRanks(), lists)
	return nil
}

// leaguePlayerWeek answers GET /leagues/attached/{id}/players/{player}.
func (s *Service) leaguePlayerWeek(w http.ResponseWriter, r *http.Request) {
	id, ok := playerParam(r)
	if !ok {
		httpx.WriteInvalid(w, r, map[string]string{fieldPlayer: playerWords})
		return
	}
	tier, bad := parseTierQuery(r)
	if len(bad) > 0 {
		httpx.WriteInvalid(w, r, bad)
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
	// The tier box ranks its players as the league's line ranks him (Lane 162).
	if err := s.withRest(r.Context(), &out, bp, tier, a); err != nil {
		httpx.WriteInternal(w, r, s.Log, "inseason: league player week rest of season", err)
		return
	}
	out.AfterBye = s.leagueAfterBye(r.Context(), a, out, bp)
	// The read is the board week's, whatever week the league is in.
	out.WeekRead = s.liveWeekRead(r.Context(), a.data.Games, bp, s.Now())
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
		lp := apitypes.LeaguePlayer{HostId: a.hostIDOfAdd(bp), BoardId: &id, Name: bp.Name, Position: string(bp.Position), Team: boards.WireClub(bp.Team)}
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
