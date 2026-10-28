package sheets

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/auth"
	"github.com/jhunthrop/commish/api/internal/boards"
)

// recorder is a Repository that remembers what was written to it.
type recorder struct {
	Repository
	format   apitypes.BoardFormat
	missing  bool
	replaced [][]apitypes.SheetRowInput
}

func (r *recorder) Get(context.Context, uuid.UUID, uuid.UUID) (apitypes.SheetDetail, error) {
	if r.missing {
		return apitypes.SheetDetail{}, ErrNotFound
	}
	return apitypes.SheetDetail{Format: r.format}, nil
}

func (r *recorder) ReplaceRows(_ context.Context, _, _ uuid.UUID, rows []apitypes.SheetRowInput, _ *string, _ *time.Time) (apitypes.SheetDetail, error) {
	if r.missing {
		return apitypes.SheetDetail{}, ErrNotFound
	}
	r.replaced = append(r.replaced, rows)
	return apitypes.SheetDetail{Format: r.format}, nil
}

type fixedBoards struct {
	loaded []boards.Format
	err    error
}

func (f *fixedBoards) Load(_ context.Context, format boards.Format) (*boards.Raw, error) {
	f.loaded = append(f.loaded, format)
	return board(), f.err
}

type importAnswer struct {
	Ok   bool `json:"ok"`
	Data struct {
		Imported int                   `json:"imported"`
		Skipped  []apitypes.ImportSkip `json:"skipped"`
	} `json:"data"`
	Error struct {
		Fields map[string]string `json:"fields"`
	} `json:"error"`
}

func postImport(t *testing.T, repo *recorder, loader *fixedBoards, contentType, body string) (int, importAnswer) {
	t.Helper()
	h := &Handler{Store: repo, Boards: loader, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}
	req := httptest.NewRequest(http.MethodPost, "/sheets/"+uuid.NewString()+"/import", strings.NewReader(body))
	req.SetPathValue("id", uuid.NewString())
	req.Header.Set("Content-Type", contentType)
	req = req.WithContext(auth.WithAccount(req.Context(), auth.Account{ID: uuid.New()}))
	rec := httptest.NewRecorder()
	h.importCSV(rec, req)
	var out importAnswer
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return rec.Code, out
}

func TestImportReadsANamesListAgainstTheSheetsBoard(t *testing.T) {
	for _, contentType := range []string{"text/plain", "text/csv"} {
		repo := &recorder{format: apitypes.BoardFormatHalfPpr}
		loader := &fixedBoards{}
		code, out := postImport(t, repo, loader, contentType, "1. Jahmyr Gibbs\n2. Nobody Real\n3. Jahmyr Gibbs\n4. Michael Thomas\n5. Bills D/ST")
		if code != http.StatusOK || out.Data.Imported != 2 || len(out.Data.Skipped) != 3 {
			t.Fatalf("%s: %d %+v", contentType, code, out)
		}
		if len(loader.loaded) != 1 || loader.loaded[0] != boards.Half {
			t.Fatalf("%s: read the %v boards, want the half PPR one", contentType, loader.loaded)
		}
		if len(repo.replaced) != 1 || repo.replaced[0][0].PlayerId != "4429795" || repo.replaced[0][1].PlayerId != "DST-BUF" {
			t.Fatalf("%s: wrote %+v", contentType, repo.replaced)
		}
	}
}

func TestImportRefusesAReadOfNoOneAndLeavesTheSheet(t *testing.T) {
	bodies := map[string]string{
		"a names list nobody is on": "Nobody Real\nSomeone Else",
		"only blank lines":          "\n  \n",
		"an empty body":             "",
		"a CSV header alone":        "rank,player_id,name,position\n",
		"a CSV of bad lines":        "rank,player_id,name,position\nx,a,B,QB\n",
	}
	for name, body := range bodies {
		repo := &recorder{}
		code, out := postImport(t, repo, &fixedBoards{}, "text/csv", body)
		if code != http.StatusBadRequest || out.Error.Fields["body"] != "No player read, so your sheet is as it was." {
			t.Errorf("%s: %d %+v", name, code, out)
		}
		if len(repo.replaced) != 0 {
			t.Errorf("%s: the sheet was written: %+v", name, repo.replaced)
		}
	}
}

func TestImportOfACSVNeedsNoBoard(t *testing.T) {
	repo := &recorder{}
	loader := &fixedBoards{}
	code, out := postImport(t, repo, loader, "text/csv", "rank,player_id,name,position\n1,a,Alpha,QB\n")
	if code != http.StatusOK || out.Data.Imported != 1 || len(loader.loaded) != 0 || len(repo.replaced) != 1 {
		t.Fatalf("%d %+v loaded %v", code, out, loader.loaded)
	}
}

func TestImportOfAHeaderWithoutPlayerIDKeepsTheHeaderSentence(t *testing.T) {
	for _, body := range []string{"rank,id,name,position\n1,a,B,QB", "Rank, Name, Position\n1,B,QB"} {
		repo := &recorder{}
		code, out := postImport(t, repo, &fixedBoards{}, "text/csv", body)
		if code != http.StatusBadRequest || out.Error.Fields["body"] != badHeaderSentence || len(repo.replaced) != 0 {
			t.Errorf("%q: %d %+v", body, code, out)
		}
	}
}

func TestImportOfAMissingSheetIs404OnBothPaths(t *testing.T) {
	for _, body := range []string{"rank,player_id,name,position\n", "Nobody Real", "rank,player_id,name,position\n1,a,Alpha,QB"} {
		repo := &recorder{missing: true}
		code, _ := postImport(t, repo, &fixedBoards{}, "text/csv", body)
		if code != http.StatusNotFound || len(repo.replaced) != 0 {
			t.Errorf("%q: %d wrote %v", body, code, repo.replaced)
		}
	}
}

func TestImportOfACSVWithAShortHeaderKeepsItsSentence(t *testing.T) {
	repo := &recorder{}
	code, out := postImport(t, repo, &fixedBoards{}, "text/csv", "player_id,name\nA,B\n")
	if code != http.StatusBadRequest || !strings.HasPrefix(out.Error.Fields["body"], "The first line must name") || len(repo.replaced) != 0 {
		t.Fatalf("%d %+v", code, out)
	}
}

func TestImportOfANamesListWithoutABoardIsUnavailableAndWritesNothing(t *testing.T) {
	repo := &recorder{}
	code, _ := postImport(t, repo, &fixedBoards{err: errors.New("down")}, "text/plain", "Jahmyr Gibbs")
	if code != http.StatusServiceUnavailable || len(repo.replaced) != 0 {
		t.Fatalf("%d wrote %v", code, repo.replaced)
	}
}
