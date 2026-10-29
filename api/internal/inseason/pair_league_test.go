package inseason

import (
	"fmt"

	"github.com/jhunthrop/commish/api/internal/draft"
)

// The package's trade tests read a 12-team league: the two squads they
// trade between and ten middling teams (middleTeam), so the median team
// is a middling one and each squad's needs are where it is thin, over
// weeks weeks from week 1, every club playing every week unless a
// player's Plays says otherwise.

func pairLeague(config []draft.SlotConfig, weeks int, mine, theirs Squad) TradeLeague {
	squads := []Squad{mine, theirs}
	for i := 0; i < 10; i++ {
		squads = append(squads, Squad{Players: middleTeam(i)})
	}
	return NewTradeLeague(config, SpanOf(weeks, weeks), squads)
}

// middleTeam is a middling roster: a starter at every position a lineup
// takes, a backup or two behind.
func middleTeam(i int) []Candidate {
	id := func(s string) string { return fmt.Sprintf("mid%d-%s", i, s) }
	return []Candidate{
		player(id("qb1"), draft.QB, 12, 50), player(id("qb2"), draft.QB, 30, 5),
		player(id("rb1"), draft.RB, 12, 60), player(id("rb2"), draft.RB, 24, 40), player(id("rb3"), draft.RB, 40, 20),
		player(id("wr1"), draft.WR, 12, 70), player(id("wr2"), draft.WR, 24, 50), player(id("wr3"), draft.WR, 36, 30),
		player(id("wr4"), draft.WR, 50, 20), player(id("te1"), draft.TE, 12, 20), player(id("te2"), draft.TE, 30, 2),
		{ID: id("k"), Position: draft.K}, {ID: id("def"), Position: draft.DEF},
	}
}

func pairTrades(config []draft.SlotConfig, weeks int, mine, theirs Squad, focus string, limit int) []Trade {
	return Trades(pairLeague(config, weeks, mine, theirs), mine, theirs, focus, limit)
}

func pairAllTrades(config []draft.SlotConfig, weeks int, mine, theirs Squad) []Trade {
	return AllTrades(pairLeague(config, weeks, mine, theirs), mine, theirs)
}

func pairCheck(config []draft.SlotConfig, weeks int, mine, theirs Squad, give, get []int) Checked {
	return Check(pairLeague(config, weeks, mine, theirs), mine, theirs, give, get)
}

func pairSearch(config []draft.SlotConfig, weeks int, mine, theirs Squad) *tradeSearch {
	return newSearch(pairLeague(config, weeks, mine, theirs), mine, theirs)
}
