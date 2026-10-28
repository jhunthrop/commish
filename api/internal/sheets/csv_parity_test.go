package sheets

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/draft"
)

// sheetParity is shared/fixtures/parity/sheet.json: the fixture sheet's
// rows and the CSV the web's export writes for them
// (shared/scripts/sheet-parity.ts over web/src/lib/sheet/csv.ts).
type sheetParity struct {
	Rows []struct {
		ID       string   `json:"id"`
		Name     string   `json:"name"`
		Position string   `json:"position"`
		Team     *string  `json:"team"`
		Tier     *int     `json:"tier"`
		Tags     []string `json:"tags"`
		Note     *string  `json:"note"`
	} `json:"rows"`
	CSV       string `json:"csv"`
	ListBoard []struct {
		ID       string  `json:"id"`
		Name     string  `json:"name"`
		Position string  `json:"position"`
		Team     *string `json:"team"`
	} `json:"listBoard"`
	Lists []struct {
		Text    string   `json:"text"`
		CSV     bool     `json:"csv"`
		IDs     []string `json:"ids"`
		Skipped []struct {
			Line   int    `json:"line"`
			Reason string `json:"reason"`
		} `json:"skipped"`
	} `json:"lists"`
}

func readParity(t *testing.T) sheetParity {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "shared", "fixtures", "parity", "sheet.json"))
	if err != nil {
		t.Fatal(err)
	}
	var parity sheetParity
	if err := json.Unmarshal(raw, &parity); err != nil {
		t.Fatal(err)
	}
	return parity
}

// The API reads a pasted names list as the web does (Lane 270): the same
// players in the same order and the same sentence for each line skipped.
func TestReadListReadsTheWebsLists(t *testing.T) {
	parity := readParity(t)
	if len(parity.ListBoard) == 0 || len(parity.Lists) == 0 {
		t.Fatal("the parity file holds no lists")
	}
	raw := &boards.Raw{}
	for _, p := range parity.ListBoard {
		position := draft.Position(p.Position)
		if p.Position == "DST" {
			position = draft.DEF
		}
		team := ""
		if p.Team != nil {
			team = *p.Team
		}
		raw.Players = append(raw.Players, boards.Player{ID: p.ID, Name: p.Name, Position: position, Team: team})
	}
	for i, c := range parity.Lists {
		if looksLikeCSV(c.Text) != c.CSV {
			t.Errorf("list %d: looksLikeCSV = %v, web says %v", i, !c.CSV, c.CSV)
		}
		if c.CSV {
			continue
		}
		rows, skipped := ReadList(c.Text, raw)
		ids := make([]string, len(rows))
		for k, r := range rows {
			ids[k] = r.PlayerId
		}
		if !slices.Equal(ids, append([]string{}, c.IDs...)) {
			t.Errorf("list %d: read %v, web reads %v", i, ids, c.IDs)
		}
		if len(skipped) != len(c.Skipped) {
			t.Errorf("list %d: skipped %v, web skips %v", i, skipped, c.Skipped)
			continue
		}
		for k, s := range skipped {
			if s.Line != c.Skipped[k].Line || s.Reason != c.Skipped[k].Reason {
				t.Errorf("list %d: skipped %v, web skips %v", i, s, c.Skipped[k])
			}
		}
	}
}

// The API's export writes the same bytes as the web's for the same rows
// (Lane 254): the file a phone shares through /sheets/{id}/exports is
// the file the site downloads, every quoted, defused and empty cell.
func TestEncodeCSVWritesTheWebsFile(t *testing.T) {
	parity := readParity(t)
	if len(parity.Rows) == 0 {
		t.Fatal("the parity file holds no rows")
	}
	detail := apitypes.SheetDetail{Rows: make([]apitypes.SheetRow, len(parity.Rows))}
	for i, r := range parity.Rows {
		detail.Rows[i] = apitypes.SheetRow{
			PlayerId: r.ID, Name: r.Name, Position: r.Position, Team: r.Team,
			Rank: i + 1, Tier: r.Tier, Tags: r.Tags, Note: r.Note,
		}
	}
	got, err := EncodeCSV(detail)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != parity.CSV {
		t.Fatalf("the export differs from the web's file:\n got: %q\nwant: %q", got, parity.CSV)
	}
}
