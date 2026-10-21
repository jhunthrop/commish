package figurewords

import "testing"

// The embedded table carries every head the web draws.
func TestTheTableNamesEveryFigure(t *testing.T) {
	if Table.Projected != "Projected" || Table.PerGame != "A game" || Table.Avg != "Avg" || Table.Week != "Wk" || Table.Points != "Points" ||
		Table.FreeAgentClub != "FA" || Table.FreeAgent != "a free agent" {
		t.Fatalf("%+v", Table)
	}
}

// A table missing a word fails, never an empty head in a sentence.
func TestATableMissingAWordFails(t *testing.T) {
	if _, err := Parse([]byte(`{"projected":"Projected"}`)); err == nil {
		t.Fatal("a table with one word parsed")
	}
	if _, err := Parse([]byte(`{"projected":"P","points":"P","perGame":"G","avg":"A","week":"W","restFrom":"from week","restFromPartial":"x {week}","freeAgentClub":"FA","freeAgent":"a free agent"}`)); err == nil {
		t.Fatal("a week template with no slot parsed")
	}
	if _, err := Parse([]byte(`not json`)); err == nil {
		t.Fatal("not json parsed")
	}
}
