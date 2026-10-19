// Package figurewords is the site's one word per figure (the ruling on
// the sweep's X1 and X2), read from words.json: the one table, which the
// web's format/figure-words.ts imports too, so the API's sentences name a
// figure by the head the web draws over it, with no second copy.
package figurewords

import (
	_ "embed"
	"encoding/json"
	"fmt"
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
}

// Parse reads a table, failing on an unknown key or an empty word.
func Parse(b []byte) (Words, error) {
	var w Words
	if err := json.Unmarshal(b, &w); err != nil {
		return Words{}, fmt.Errorf("figurewords: %w", err)
	}
	for name, word := range map[string]string{"projected": w.Projected, "points": w.Points, "perGame": w.PerGame, "avg": w.Avg, "week": w.Week} {
		if word == "" {
			return Words{}, fmt.Errorf("figurewords: no word for %s", name)
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
