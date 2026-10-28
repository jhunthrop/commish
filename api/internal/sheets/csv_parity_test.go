package sheets

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
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
	CSV string `json:"csv"`
}

// The API's export writes the same bytes as the web's for the same rows
// (Lane 254): the file a phone shares through /sheets/{id}/exports is
// the file the site downloads, every quoted, defused and empty cell.
func TestEncodeCSVWritesTheWebsFile(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "shared", "fixtures", "parity", "sheet.json"))
	if err != nil {
		t.Fatal(err)
	}
	var parity sheetParity
	if err := json.Unmarshal(raw, &parity); err != nil {
		t.Fatal(err)
	}
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
