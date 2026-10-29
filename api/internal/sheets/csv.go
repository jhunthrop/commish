package sheets

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"maps"
	"slices"
	"strconv"
	"strings"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// Columns is the CSV's header, the export's and the import's.
func Columns() []string {
	return []string{"rank", "player_id", "name", "position", "team", "tier", "tags", "note"}
}

// headerAliases are other names an import reads as one of Columns: the
// single tag column this file had before tags became a list.
func headerAliases() map[string]string { return map[string]string{"tag": "tags"} }

// byteOrderMark is what a spreadsheet often writes before the header.
const byteOrderMark = "\uFEFF"

// requiredColumns must be present in an import.
func requiredColumns() []string { return []string{"rank", "player_id", "name", "position"} }

// formulaLead are the characters a spreadsheet reads as the start of a
// formula. An exported cell starting with one is prefixed with a quote,
// and an imported cell has that quote taken off again.
const formulaLead = "=+-@\t\r"

func defuse(s string) string {
	if s != "" && strings.ContainsRune(formulaLead, rune(s[0])) {
		return "'" + s
	}
	return s
}

func undefuse(s string) string {
	if len(s) > 1 && s[0] == '\'' && strings.ContainsRune(formulaLead, rune(s[1])) {
		return s[1:]
	}
	return s
}

func deref[T any](p *T, format func(T) string) string {
	if p == nil {
		return ""
	}
	return format(*p)
}

// EncodeCSV writes the sheet in rank order with the header first.
func EncodeCSV(d apitypes.SheetDetail) ([]byte, error) {
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)
	if err := w.Write(Columns()); err != nil {
		return nil, fmt.Errorf("sheets: csv header: %w", err)
	}
	for _, r := range d.Rows {
		rec := []string{
			strconv.Itoa(r.Rank), defuse(r.PlayerId), defuse(r.Name), defuse(r.Position),
			defuse(deref(r.Team, func(s string) string { return s })),
			deref(r.Tier, strconv.Itoa),
			defuse(joinTagCell(r.Tags)),
			defuse(deref(r.Note, func(s string) string { return s })),
		}
		if err := w.Write(rec); err != nil {
			return nil, fmt.Errorf("sheets: csv row %d: %w", r.Rank, err)
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return nil, fmt.Errorf("sheets: csv flush: %w", err)
	}
	return buf.Bytes(), nil
}

// ErrBadHeader is an import whose first line is not a usable header.
var ErrBadHeader = errors.New("sheets: csv header")

type ranked struct {
	rank int
	line int
	row  apitypes.SheetRowInput
}

// DecodeCSV reads an import: a header naming at least rank, player_id,
// name and position (any order, any case), then one player per line.
// A bad line is skipped with its reason; the rest are returned in rank
// order.
func DecodeCSV(r io.Reader) ([]apitypes.SheetRowInput, []apitypes.ImportSkip, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1
	cr.TrimLeadingSpace = true
	header, err := cr.Read()
	var parseErr *csv.ParseError
	switch {
	case errors.Is(err, io.EOF) || errors.As(err, &parseErr):
		return nil, nil, fmt.Errorf("%w: %w", ErrBadHeader, err)
	case err != nil:
		return nil, nil, fmt.Errorf("sheets: read csv: %w", err)
	}
	col := map[string]int{}
	aliases := headerAliases()
	for i, h := range header {
		name := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(h, byteOrderMark)))
		if canonical, ok := aliases[name]; ok {
			name = canonical
		}
		if _, taken := col[name]; !taken {
			col[name] = i
		}
	}
	for _, c := range requiredColumns() {
		if _, ok := col[c]; !ok {
			return nil, nil, fmt.Errorf("%w: missing %s", ErrBadHeader, c)
		}
	}
	var keep []ranked
	skipped := []apitypes.ImportSkip{}
	seen := map[string]bool{}
	for line := 2; ; line++ {
		rec, err := cr.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if errors.As(err, &parseErr) {
			skipped = append(skipped, apitypes.ImportSkip{Line: line, Reason: "This row is not valid CSV"})
			continue
		}
		if err != nil {
			// The body itself failed (too large, or the connection), not
			// a line of it: stop rather than read the same error forever.
			return nil, nil, fmt.Errorf("sheets: read csv: %w", err)
		}
		rk, reason := decodeRecord(rec, col)
		switch {
		case reason != "":
			skipped = append(skipped, apitypes.ImportSkip{Line: line, Reason: reason})
		case seen[rk.row.PlayerId]:
			skipped = append(skipped, apitypes.ImportSkip{Line: line, Reason: "This player is already on an earlier row"})
		case len(keep) >= MaxRows:
			skipped = append(skipped, apitypes.ImportSkip{Line: line, Reason: fmt.Sprintf("A sheet holds at most %d players", MaxRows)})
		default:
			seen[rk.row.PlayerId] = true
			rk.line = line
			keep = append(keep, rk)
		}
	}
	slices.SortStableFunc(keep, func(a, b ranked) int { return a.rank - b.rank })
	rows := make([]apitypes.SheetRowInput, len(keep))
	for i, k := range keep {
		rows[i] = k.row
	}
	return rows, skipped, nil
}

func field(rec []string, col map[string]int, name string) string {
	i, ok := col[name]
	if !ok || i >= len(rec) {
		return ""
	}
	return undefuse(strings.TrimSpace(rec[i]))
}

func optional(rec []string, col map[string]int, name string) *string {
	if v := field(rec, col, name); v != "" {
		return &v
	}
	return nil
}

// decodeRecord turns one line into a row, or the reason it cannot be.
func decodeRecord(rec []string, col map[string]int) (ranked, string) {
	rank, err := strconv.Atoi(field(rec, col, "rank"))
	if err != nil || rank < 1 {
		return ranked{}, "The rank is not a whole number from 1"
	}
	row := apitypes.SheetRowInput{
		PlayerId: field(rec, col, "player_id"), Name: field(rec, col, "name"),
		Position: canonicalPosition(field(rec, col, "position")), Team: optional(rec, col, "team"), Note: optional(rec, col, "note"),
	}
	if v := field(rec, col, "tier"); v != "" {
		t, err := strconv.Atoi(v)
		if err != nil {
			return ranked{}, "The tier is not a whole number"
		}
		row.Tier = &t
	}
	cell := splitTagCell(field(rec, col, "tags"))
	tags := normalizeTags(&cell)
	row.Tags = &tags
	if errs := validateRows([]apitypes.SheetRowInput{row}); errs != nil {
		first := slices.Min(slices.Collect(maps.Keys(errs)))
		return ranked{}, fmt.Sprintf("%s: %s", strings.TrimPrefix(first, "rows.0."), errs[first])
	}
	return ranked{rank: rank, row: row}, ""
}
