package runs

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // the days are named on the Eastern clock; the image may carry no zone files

	"golang.org/x/sync/errgroup"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// The run's season reach (Lane 203): what every basis's "through week"
// says, counted over every own page of the run the way the web counts
// it (web/src/lib/run/reach.ts runReach, server/run.ts seasonReach). Each
// function below is the web's of the same name, line for line.

// pageReads bounds the page reads one reach pass has in flight.
const pageReads = 16

// eastern is the clock a game's day is named on, the NFL's (the web's
// format/date.ts weekdayWord).
var eastern = mustZone("America/New_York")

func mustZone(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		// time/tzdata is embedded, so this cannot happen in a build.
		panic("runs: no " + name + " zone: " + err.Error())
	}
	return loc
}

// The run's game statuses a reach reads (the web's GAME_STATUSES).
const (
	statusPlayed   = "played"
	statusInactive = "inactive"
)

// countedRow is what a reach reads of one week of a log.
type countedRow struct {
	Week        int     `json:"week"`
	Status      string  `json:"status"`
	Opponent    *string `json:"opponent"`
	UnnamedGame *bool   `json:"unnamedGame"`
}

// countedPage is what a reach reads of a player's page: his club and his
// season block's format, through week and log.
type countedPage struct {
	ID     string `json:"id"`
	Team   string `json:"team"`
	Season struct {
		Format  string       `json:"format"`
		Through int          `json:"through"`
		Log     []countedRow `json:"log"`
	} `json:"season"`
}

// reach is the complete week and the partial week after it.
type reach struct {
	complete int
	partial  *partialWeek
}

// partialWeek is a week with some games in: their days in kickoff order
// (none when a counted club's game is not on the schedule) and how many.
type partialWeek struct {
	week  int
	days  []string
	games int
}

// holdsAGame is a week holding a game of his: played, inactive with his
// club's game named, or one he played that the run cannot name.
func holdsAGame(row countedRow) bool {
	if row.Status == statusPlayed {
		return true
	}
	return row.Status == statusInactive && (row.Opponent != nil || (row.UnnamedGame != nil && *row.UnnamedGame))
}

// countedWeek is the week his season's figures reach: the run's through
// week, or his own later game already in the records.
func countedWeek(page countedPage) int {
	week := page.Season.Through
	for _, row := range page.Season.Log {
		if holdsAGame(row) {
			week = max(week, row.Week)
		}
	}
	return week
}

// newestCountedWeek is the newest week any player's counted game
// belongs to; 0 with no page.
func newestCountedWeek(pages []countedPage) int {
	week := 0
	for _, page := range pages {
		week = max(week, countedWeek(page))
	}
	return week
}

// gameKey is each game of a week once: both clubs' sides are one game.
func gameKey(club, opponent string) string {
	pair := []string{club, opponent}
	slices.Sort(pair)
	return strings.Join(pair, "-")
}

// partialOf is a partial week from its games' kickoffs: their days in
// kickoff order on the Eastern clock and how many.
func partialOf(week int, kickoffs []time.Time) *partialWeek {
	ordered := slices.Clone(kickoffs)
	slices.SortStableFunc(ordered, func(a, b time.Time) int { return a.Compare(b) })
	days := []string{}
	for _, kickoff := range ordered {
		if day := kickoff.In(eastern).Weekday().String(); !slices.Contains(days, day) {
			days = append(days, day)
		}
	}
	return &partialWeek{week: week, days: days, games: len(ordered)}
}

// countedReach is the complete week, then the next week's games a
// player's counts hold (a played or inactive row in his log, his club's
// game by the schedule), never a game final by its status alone. A
// counted club the schedule does not place says "part of the week".
func countedReach(pages []countedPage, slates []apitypes.RunSlate, complete int) reach {
	newest := newestCountedWeek(pages)
	if newest <= complete {
		return reach{complete: complete}
	}
	var clubs []string
	for _, page := range pages {
		if slices.ContainsFunc(page.Season.Log, func(r countedRow) bool {
			return r.Week == newest && (r.Status == statusPlayed || r.Status == statusInactive)
		}) && !slices.Contains(clubs, page.Team) {
			clubs = append(clubs, page.Team)
		}
	}
	kickoffs := map[string]time.Time{}
	placed := true
	for _, club := range clubs {
		game, ok := gameOf(slates, club, newest)
		if !ok {
			placed = false
			continue
		}
		kickoffs[gameKey(club, game.Opponent)] = game.Kickoff
	}
	if !placed {
		return reach{complete: complete, partial: &partialWeek{week: newest, days: []string{}}}
	}
	return reach{complete: complete, partial: partialOf(newest, mapValues(kickoffs))}
}

// gameOf is a club's first game of a week on the schedule.
func gameOf(slates []apitypes.RunSlate, club string, week int) (apitypes.RunGame, bool) {
	i := slices.IndexFunc(slates, func(s apitypes.RunSlate) bool { return s.Abbr == club })
	if i < 0 {
		return apitypes.RunGame{}, false
	}
	j := slices.IndexFunc(slates[i].Games, func(g apitypes.RunGame) bool { return g.Week == week })
	if j < 0 {
		return apitypes.RunGame{}, false
	}
	return slates[i].Games[j], true
}

func mapValues(m map[string]time.Time) []time.Time {
	values := make([]time.Time, 0, len(m))
	for _, v := range m {
		values = append(values, v)
	}
	return values
}

func joinAnd(words []string) string {
	if len(words) <= 1 {
		return strings.Join(words, "")
	}
	return strings.Join(words[:len(words)-1], ", ") + " and " + words[len(words)-1]
}

// partialWords is "week 6's Thursday game", "week 16's Thursday and
// Saturday games", "part of week 6".
func partialWords(p partialWeek) string {
	week := strconv.Itoa(p.week)
	if len(p.days) == 0 {
		return "part of week " + week
	}
	noun := "games"
	if p.games == 1 {
		noun = "game"
	}
	return "week " + week + "'s " + joinAnd(p.days) + " " + noun
}

// reachWords is "through week 5", "through week 5 and week 6's Thursday
// game", and "" before week 1's games.
func reachWords(r reach) string {
	whole := ""
	if r.complete != 0 {
		whole = "week " + strconv.Itoa(r.complete)
	}
	if r.partial == nil {
		if whole == "" {
			return ""
		}
		return "through " + whole
	}
	if whole != "" {
		whole += " and "
	}
	return "through " + whole + partialWords(*r.partial)
}

// runReach is the run's season reach over its own pages, in the index's
// order: the first page's block names the format and the complete week,
// which every block in the run shares (the web's season-checks.ts).
func runReach(pages []countedPage, slates []apitypes.RunSlate, formats []apitypes.RunFormat) (apitypes.RunReach, error) {
	if len(pages) == 0 {
		return apitypes.RunReach{}, fmt.Errorf("runs: the run has no page the reader took")
	}
	format, complete := pages[0].Season.Format, pages[0].Season.Through
	// Every block shares them, as the web's gate refuses a run otherwise:
	// a run that skipped the gate gets no reach rather than a wrong one.
	for _, page := range pages {
		if page.Season.Format != format || page.Season.Through != complete {
			return apitypes.RunReach{}, fmt.Errorf("runs: page %s is scored in %s through week %d, not %s through week %d",
				page.ID, page.Season.Format, page.Season.Through, format, complete)
		}
	}
	i := slices.IndexFunc(formats, func(f apitypes.RunFormat) bool { return f.Id == format })
	if i < 0 {
		return apitypes.RunReach{}, fmt.Errorf("runs: the run has no %s format", format)
	}
	counted := countedReach(pages, slates, complete)
	out := apitypes.RunReach{Format: format, Scoring: formats[i].Label, Through: reachWords(counted), Complete: complete}
	if counted.partial != nil {
		out.Partial = &apitypes.RunReachPartial{Week: counted.partial.week, Days: counted.partial.days}
	}
	return out, nil
}

// composeManifest is the manifest's answer with the reach beside it, and
// how many pages it counted, every file read in the run runID: the
// manifest, the held pages, the index, the schedule, and each page the
// index gives that the gate did not hold (a held page's copy is an
// earlier run's season). Each file read is bounded by its own
// readTimeout and the pass by ctx, checked between them.
func composeManifest(ctx context.Context, r *Reader, runID string) (Answer, int, error) {
	manifest, err := r.ReadIn(ctx, runID, manifestFile)
	if err != nil {
		return Answer{}, 0, err
	}
	var answer struct {
		Manifest json.RawMessage `json:"manifest"`
	}
	if err := json.Unmarshal(manifest.Data, &answer); err != nil {
		return Answer{}, 0, fmt.Errorf("manifest: %w", err)
	}
	var run apitypes.RunManifest
	if err := json.Unmarshal(answer.Manifest, &run); err != nil {
		return Answer{}, 0, fmt.Errorf("manifest: %w", err)
	}
	ids, err := ownPageIDs(ctx, r, runID)
	if err != nil {
		return Answer{}, 0, err
	}
	schedule, err := r.ReadIn(ctx, runID, scheduleFile)
	if err != nil {
		return Answer{}, 0, err
	}
	var slates struct {
		Schedule apitypes.RunSchedule `json:"schedule"`
	}
	if err := json.Unmarshal(schedule.Data, &slates); err != nil {
		return Answer{}, 0, fmt.Errorf("schedule: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return Answer{}, 0, err
	}
	pages, err := readPages(ctx, r, runID, ids)
	if err != nil {
		return Answer{}, 0, err
	}
	reached, err := runReach(pages, slates.Schedule.Slates, run.Formats)
	if err != nil {
		return Answer{}, 0, err
	}
	value, err := json.Marshal(reached)
	if err != nil {
		return Answer{}, 0, err
	}
	data, err := encodeAnswer(runID, []field{{"manifest", answer.Manifest}, {"reach", value}})
	if err != nil {
		return Answer{}, 0, err
	}
	// The manifest's ETag: the reach is the run's own pages and schedule,
	// written once with it.
	return Answer{RunID: runID, ETag: etag(runID, manifestFile, data), Data: data}, len(pages), nil
}

// ownPageIDs is every id the index gives a page that the gate did not
// hold, in the index's order (the web's ownPages).
func ownPageIDs(ctx context.Context, r *Reader, runID string) ([]string, error) {
	heldAnswer, err := r.ReadIn(ctx, runID, heldFile)
	if err != nil {
		return nil, err
	}
	held, err := heldIDs(heldAnswer)
	if err != nil {
		return nil, err
	}
	index, err := r.ReadIn(ctx, runID, indexFile)
	if err != nil {
		return nil, err
	}
	var data struct {
		Pages []struct {
			ID string `json:"id"`
		} `json:"pages"`
	}
	if err := json.Unmarshal(index.Data, &data); err != nil {
		return nil, fmt.Errorf("runs: run %s index pages: %w", runID, err)
	}
	ids := make([]string, 0, len(data.Pages))
	for _, page := range data.Pages {
		// An id becomes a bucket key, so it is the route's id or refused.
		if !playerIDPattern.MatchString(page.ID) {
			return nil, fmt.Errorf("runs: run %s index gives a page to %q, not a player id", runID, page.ID)
		}
		if _, isHeld := held[page.ID]; !isHeld {
			ids = append(ids, page.ID)
		}
	}
	return ids, nil
}

// readPages reads each page's season block once, pageReads at a time,
// each read straight from the bucket (the pass's answer is what is kept,
// not the pages), each refused when it is another player's page.
func readPages(ctx context.Context, r *Reader, runID string, ids []string) ([]countedPage, error) {
	pages := make([]countedPage, len(ids))
	g, ctx := errgroup.WithContext(ctx)
	g.SetLimit(pageReads)
	for i, id := range ids {
		g.Go(func() error {
			if err := ctx.Err(); err != nil {
				return err
			}
			file := "players/" + id + ".json"
			raw, err := r.objects.Get(ctx, fileKey(runID, file))
			if err != nil {
				return err
			}
			if err := json.Unmarshal(raw, &pages[i]); err != nil {
				return fmt.Errorf("runs: run %s %s: %w", runID, file, err)
			}
			if pages[i].ID != id {
				return fmt.Errorf("runs: run %s %s is the page of %q", runID, file, pages[i].ID)
			}
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}
	return pages, nil
}
