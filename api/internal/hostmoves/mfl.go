package hostmoves

// A MyFantasyLeague lineup move (Lane 67): the same plan, token, proof
// and answer as ESPN's, planned on a fresh read of the member's own team
// with their kept session and sent as the documented lineup import. A
// MyFantasyLeague lineup has no slots, only starters, so the screen's
// changes become the whole set of starters: each change's player in
// starts, each starter out sits.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/hosts/mflhost"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
	"github.com/jhunthrop/commish/api/internal/mfl"
)

// mflPlan is a lineup checked against a fresh read: the set
// MyFantasyLeague takes and the move in words.
type mflPlan struct {
	set      mfl.LineupSet
	sentence string
}

// mflRecord is the plan as the proof keeps it: the words, the franchise,
// the week and the starters sent.
type mflRecord struct {
	Sentence  string   `json:"sentence"`
	Franchise int      `json:"franchise"`
	Week      int      `json:"week"`
	Starters  []string `json:"starters"`
}

// prepareMFL reads the member's team with their session and plans the
// move on it. It answers a refusal itself and reports false.
func (s *Service) prepareMFL(w http.ResponseWriter, r *http.Request, link leaguesync.Link, mv apitypes.HostMoveInput, words kindWords) (prepared, bool) {
	ctx, accountID := r.Context(), auth.AccountID(r)
	team, sess, err := s.MFLMember.Lineup(ctx, accountID, link.Ref.LeagueID, link.Ref.Season)
	if unavailable, answered := s.readRefusal(w, r, err, words); answered || unavailable != "" {
		return prepared{unavailable: unavailable}, unavailable != ""
	}
	players := s.playersOf(ctx, mflhost.Host, idsOf(mv, team))
	plan, err := planMFL(team, link.RosterID, mv, players)
	if !s.planRefusal(w, r, err, words) {
		return prepared{}, false
	}
	var ref *refusal
	if errors.As(err, &ref) && ref.unavailable {
		return prepared{unavailable: ref.words}, true
	}
	return prepared{mfl: &plan, session: sess}, true
}

// idsOf is every player a move names or starts, for their names and
// positions.
func idsOf(mv apitypes.HostMoveInput, team mfl.TeamLineup) []string {
	ids := slices.Clone(team.Starters)
	for _, c := range mv.Changes {
		ids = append(ids, c.In)
		if c.Out != nil {
			ids = append(ids, *c.Out)
		}
	}
	return ids
}

// playersOf is the platform's kept directory rows for the ids; a failed
// read is logged and leaves the names to their ids and the positions to
// MyFantasyLeague's own check.
func (s *Service) playersOf(ctx context.Context, host string, ids []string) map[string]leaguesync.HostPlayer {
	if s.Players == nil {
		return nil
	}
	out, err := s.Players.HostPlayersByID(ctx, host, ids)
	if err != nil {
		s.Log.Warn("hostmoves: players", "host", host, "err", err)
		return nil
	}
	return out
}

// planMFL turns the screen's changes into the member's starters: the week
// must be MyFantasyLeague's current one, the team the attached league's
// seat, each player in on the active roster, each player out a starter
// now, and the starters within the league's counts where the positions
// are known. mfl.OwnLineup checks the franchise and the roster again.
func planMFL(team mfl.TeamLineup, me int, mv apitypes.HostMoveInput, players map[string]leaguesync.HostPlayer) (mflPlan, error) {
	name := func(id string) string {
		if p, ok := players[id]; ok && p.Name != "" {
			return p.Name
		}
		return "player " + id
	}
	if team.Franchise != me {
		return mflPlan{}, &refusal{words: mflWords.notYourTeam, cause: mfl.ErrNotYourTeam, unavailable: true}
	}
	if mv.Week != team.Week {
		return mflPlan{}, refuse(fmt.Sprintf(mflWords.weekMoved, team.Week), fmt.Errorf("week %d is not MyFantasyLeague's %d", mv.Week, team.Week))
	}
	starters, err := startersAfter(team, mv.Changes, name)
	if err != nil {
		return mflPlan{}, err
	}
	if err := fitsMFL(team, mv.Changes, starters, players, name); err != nil {
		return mflPlan{}, err
	}
	// The franchise is checked above, so a refusal here is the roster or
	// the count moving under the screen.
	set, err := mfl.OwnLineup(team, me, starters)
	if err != nil {
		return mflPlan{}, refuse(mflWords.stale, err)
	}
	return mflPlan{set: set, sentence: lineupSentence(mv.Changes, name, mflWords)}, nil
}

// startersAfter is the starters once each change's player in starts and
// each starter out sits. A screen read before a change on
// MyFantasyLeague cannot sit someone it did not mean to: every player out
// must start now, and a move that changes nothing is stale.
func startersAfter(team mfl.TeamLineup, changes []apitypes.HostMoveChange, name func(string) string) ([]string, error) {
	active, reserve, taxi, now := setOf(team.Roster), setOf(team.Reserve), setOf(team.Taxi), setOf(team.Starters)
	ins, outs := map[string]bool{}, map[string]bool{}
	for _, c := range changes {
		switch {
		case reserve[c.In]:
			return nil, refuse(fmt.Sprintf(mflWords.reserve, name(c.In)), fmt.Errorf("player %s is on injured reserve", c.In))
		case taxi[c.In]:
			return nil, refuse(fmt.Sprintf(mflWords.taxi, name(c.In)), fmt.Errorf("player %s is on the taxi squad", c.In))
		case !active[c.In] || ins[c.In]:
			return nil, refuse(mflWords.stale, fmt.Errorf("player %s is not on the roster, or starts twice", c.In))
		}
		ins[c.In] = true
		if c.Out == nil {
			continue
		}
		if !now[*c.Out] || outs[*c.Out] {
			return nil, refuse(mflWords.stale, fmt.Errorf("player %s does not start now", *c.Out))
		}
		outs[*c.Out] = true
	}
	var out []string
	for _, id := range team.Starters {
		if !outs[id] || ins[id] {
			out = append(out, id)
		}
	}
	for _, c := range changes {
		if !slices.Contains(out, c.In) {
			out = append(out, c.In)
		}
	}
	switch {
	case sameSet(out, team.Starters):
		return nil, refuse(mflWords.stale, errors.New("the move changes no starter"))
	// The import takes the whole lineup: a move never starts fewer than
	// start now, nor than the league starts when it says.
	case len(out) < len(team.Starters) || (team.StarterCount > 0 && len(out) < team.StarterCount):
		return nil, refuse(mflWords.stale, fmt.Errorf("%d starters after the move, %d now, %d in the league", len(out), len(team.Starters), team.StarterCount))
	}
	return out, nil
}

func setOf(ids []string) map[string]bool {
	out := make(map[string]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out
}

func sameSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	in := setOf(b)
	for _, id := range a {
		if !in[id] {
			return false
		}
	}
	return true
}

// slotTakes is the positions a slot starts.
var slotTakes = map[apitypes.HostMoveChangeSlot][]string{
	apitypes.HostMoveChangeSlotQB: {"QB"}, apitypes.HostMoveChangeSlotRB: {"RB"}, apitypes.HostMoveChangeSlotWR: {"WR"},
	apitypes.HostMoveChangeSlotTE: {"TE"}, apitypes.HostMoveChangeSlotK: {"K"}, apitypes.HostMoveChangeSlotDEF: {"DEF"},
	apitypes.HostMoveChangeSlotFLEX: {"RB", "WR", "TE"}, apitypes.HostMoveChangeSlotSUPERFLEX: {"QB", "RB", "WR", "TE"},
}

// fitsMFL checks what the kept directory knows: each player in may start
// in his change's slot, and no position starts more, or fewer, than the
// league allows. A player whose position is unknown leaves the counts to
// MyFantasyLeague.
func fitsMFL(team mfl.TeamLineup, changes []apitypes.HostMoveChange, starters []string, players map[string]leaguesync.HostPlayer, name func(string) string) error {
	for _, c := range changes {
		if p, ok := players[c.In]; ok && p.Position != "" && !slices.Contains(slotTakes[c.Slot], p.Position) {
			return refuse(fmt.Sprintf(mflWords.cannotFill, name(c.In)), fmt.Errorf("player %s is a %s, not for %s", c.In, p.Position, c.Slot))
		}
	}
	counts := map[string]int{}
	for _, id := range starters {
		p, ok := players[id]
		if !ok || p.Position == "" {
			return nil
		}
		counts[p.Position]++
	}
	for _, l := range team.Limits {
		switch n := counts[l.Position]; {
		case n > l.Max:
			return refuse(fmt.Sprintf(mflWords.limit, l.Position), fmt.Errorf("%d start at %s, at most %d", n, l.Position, l.Max))
		case n < l.Min:
			return refuse(fmt.Sprintf(mflWords.fewer, l.Min, l.Position), fmt.Errorf("%d start at %s, at least %d", n, l.Position, l.Min))
		}
	}
	return nil
}

// outgoingMFL is the planned lineup ready to leave with the member's
// session.
func (s *Service) outgoingMFL(plan mflPlan, sess mfl.Session) (outgoing, error) {
	body, err := plan.set.Body()
	record := mflRecord{Sentence: plan.sentence, Franchise: plan.set.Franchise(), Week: plan.set.Week(), Starters: plan.set.Starters()}
	return outgoing{body: body, record: record, make: func(ctx context.Context) (Answer, string, error) {
		ans, err := s.MFLWriter.SetLineup(ctx, sess, plan.set)
		if err != nil {
			return Answer{}, "", err
		}
		a := s.settleMFL(ctx, sess, plan.set, ans)
		return a, mflResultWords(a), nil
	}}, err
}

// settleMFL is what a sent lineup came to: a refusal is MyFantasyLeague's,
// anything else is read back, done when its starters are the lineup's and
// pending when they are not or the read fails. Never a retry.
func (s *Service) settleMFL(ctx context.Context, sess mfl.Session, set mfl.LineupSet, ans mfl.WriteAnswer) Answer {
	a := Answer{HostStatus: ans.Status}
	if ans.Lost != "" {
		// The cause is kept for the log, never MyFantasyLeague's answer.
		s.Log.Warn("hostmoves: the answer was lost", "host", mflhost.Host, "lost", ans.Lost, "status", ans.Status)
	}
	if ans.Outcome == mfl.WriteRefused {
		a.Outcome, a.HostWords, a.ReadBack = OutcomeRefused, ans.Words, readNotRead
		return a
	}
	matched, err := s.MFLWriter.Applied(ctx, sess, set)
	switch {
	case err != nil:
		s.Log.Warn("hostmoves: read back", "host", mflhost.Host, "err", err)
		a.Outcome, a.ReadBack = OutcomePending, readNotRead
	case matched:
		a.Outcome, a.ReadBack = OutcomeDone, readMatched
	default:
		a.Outcome, a.ReadBack = OutcomePending, readNotMatched
	}
	return a
}

// lockRefusal is MyFantasyLeague refusing a lineup for a game under way:
// lock wording only ("locked", "lock at kickoff"), never "started" alone.
// The words are guessed until the proof move captures the real refusal.
var lockRefusal = regexp.MustCompile(`(?i)\block(ed|s)?\b`)

// mflResultWords is our sentence for what a MyFantasyLeague lineup came
// to: a lock in its words is said plainly.
func mflResultWords(a Answer) string {
	if a.Outcome == OutcomeRefused && lockRefusal.MatchString(a.HostWords) {
		return mflWords.locked
	}
	return lineupResultWords(a, mflWords)
}
