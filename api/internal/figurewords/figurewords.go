// Package figurewords is the site's one word per figure (the ruling on
// the sweep's X1 and X2), read from words.json: the one table, which the
// web's format/figure-words.ts imports too, so the API's sentences name a
// figure by the head the web draws over it, with no second copy.
package figurewords

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

//go:embed words.json
var raw []byte

// Words is each figure's head.
type Words struct {
	// Projected heads the projection's total, the rest of the season's in
	// season.
	Projected string `json:"projected"`
	// Points heads points scored to date.
	Points string `json:"points"`
	// PerGame heads the rest-of-season projection a game.
	PerGame string `json:"perGame"`
	// Avg heads this season's points a game to date.
	Avg string `json:"avg"`
	// Week heads this week's projection beside the season's ("Wk 6").
	Week string `json:"week"`
	// RestFrom is the week a rest of season starts from, "{week}" its
	// number: "from week 7".
	RestFrom string `json:"restFrom"`
	// RestFromPartial is the same while a game of that week has kicked
	// off (Lane 86): "from week 6's games left".
	RestFromPartial string `json:"restFromPartial"`
	// FreeAgentClub is the club cell of a player with no club (Lane 123,
	// B101): the daily list names him a free agent and the store holds
	// NULL, so every answer that carries a club string carries this one.
	FreeAgentClub string `json:"freeAgentClub"`
	// FreeAgent says the same in a sentence: "a free agent".
	FreeAgent string `json:"freeAgent"`
}

// WeekSlot is the placeholder RestFrom and RestFromPartial carry.
const WeekSlot = "{week}"

// Parse reads a table, failing on an unknown key or an empty word.
func Parse(b []byte) (Words, error) {
	var w Words
	if err := json.Unmarshal(b, &w); err != nil {
		return Words{}, fmt.Errorf("figurewords: %w", err)
	}
	for name, word := range map[string]string{"projected": w.Projected, "points": w.Points, "perGame": w.PerGame, "avg": w.Avg, "week": w.Week,
		"restFrom": w.RestFrom, "restFromPartial": w.RestFromPartial, "freeAgentClub": w.FreeAgentClub, "freeAgent": w.FreeAgent} {
		if word == "" {
			return Words{}, fmt.Errorf("figurewords: no word for %s", name)
		}
	}
	for name, template := range map[string]string{"restFrom": w.RestFrom, "restFromPartial": w.RestFromPartial} {
		if !strings.Contains(template, WeekSlot) {
			return Words{}, fmt.Errorf("figurewords: %s has no %s", name, WeekSlot)
		}
	}
	return w, nil
}

// Table is the embedded table, read once; a malformed file fails the
// binary at start, never a sentence.
var Table = mustParse(raw)

func mustParse(b []byte) Words {
	w, err := Parse(b)
	if err != nil {
		panic(err)
	}
	return w
}
