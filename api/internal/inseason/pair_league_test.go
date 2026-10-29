package inseason

import "github.com/jhunthrop/commish/api/internal/draft"

// The package's trade tests read a league of the two squads they trade
// between: its median at each slot is theirs, over weeks weeks from week 1,
// every club playing every week unless a player's Plays says otherwise.

func pairLeague(config []draft.SlotConfig, weeks int, mine, theirs Squad) TradeLeague {
	return NewTradeLeague(config, SpanOf(weeks, weeks), []Squad{mine, theirs})
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
