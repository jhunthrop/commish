package runs

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"regexp"
	"sync"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// playerIDPattern is the web's PLAYER_ID (web/src/lib/run/schema.ts): a
// player id becomes a file name, so it is word characters and hyphens.
var playerIDPattern = regexp.MustCompile(`^[\w-]+$`)

// The run's other files (Lane 188): the record, the clubs, the schedule,
// and the pages the nightly's schema gate held (held.json, optional: a
// run that held none carries none). Each is written once with its run.
var (
	recordFile   = artifact{path: "record.json", name: "record", shape: whole("record", reflect.TypeFor[apitypes.RunRecord]())}
	clubsFile    = artifact{path: "clubs.json", name: "clubs", shape: whole("clubs", reflect.TypeFor[[]apitypes.RunClub]())}
	scheduleFile = artifact{path: "schedule.json", name: "schedule", shape: whole("schedule", reflect.TypeFor[apitypes.RunSchedule]())}
	heldFile     = artifact{path: "held.json", name: "held", optional: true, shape: whole("held", reflect.TypeFor[apitypes.RunHeld]())}
)

var playerType = reflect.TypeFor[apitypes.RunPlayer]()

// playerFile is his page tonight (players/<id>.json), and copyFile a held
// page's copy from an earlier run (held/<id>.json). Each is refused when
// it is another player's page.
func playerFile(id string) artifact { return pageOf("players/"+id+".json", id) }

func copyFile(id string) artifact { return pageOf("held/"+id+".json", id) }

func pageOf(file, id string) artifact {
	return artifact{path: file, name: "player", shape: func(raw []byte) ([]field, error) {
		var page struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(raw, &page); err != nil {
			return nil, fmt.Errorf("%s: %w", file, err)
		}
		if page.ID != id {
			return nil, fmt.Errorf("%s is the page of %q", file, page.ID)
		}
		value, err := project(raw, playerType)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", file, err)
		}
		return []field{{"player", value}}, nil
	}}
}

// pageState is where a player id stands in one run: whether the index
// gives him a page, whether the gate held it, and whether an earlier
// run's copy stands in for it.
type pageState struct {
	runID   string
	paged   bool
	held    bool
	hasCopy bool
}

// handlePlayer answers his page tonight. An id the run gives no page (a
// kicker, a defense, anyone the index does not list) is 404, and so is a
// held page: the gate refused tonight's document, so it is never sent;
// /run/held says whether a copy stands in. The page is read in the run
// the held pages were read from, so a pointer moving between the reads
// cannot send another run's refused page.
func (h *Handler) handlePlayer(w http.ResponseWriter, r *http.Request) {
	id, ok := h.playerID(w, r)
	if !ok {
		return
	}
	state, err := h.stateOf(r.Context(), id)
	switch {
	case err != nil:
		h.unavailable(w, r, err)
	case !state.paged:
		h.noPage(w, r, "The run has no page for "+id+".")
	case state.held:
		h.noPage(w, r, "His page is held this run; /run/held says whether a copy stands in.")
	default:
		h.serveIn(w, r, state.runID, playerFile(id))
	}
}

// handleCopy answers a held page's copy from an earlier run, 404 for an
// id the run does not hold with a copy, read in the run that holds it.
func (h *Handler) handleCopy(w http.ResponseWriter, r *http.Request) {
	id, ok := h.playerID(w, r)
	if !ok {
		return
	}
	state, err := h.stateOf(r.Context(), id)
	switch {
	case err != nil:
		h.unavailable(w, r, err)
	case !state.paged || !state.held || !state.hasCopy:
		h.noPage(w, r, "The run holds no copy of a page for "+id+".")
	default:
		h.serveIn(w, r, state.runID, copyFile(id))
	}
}

// stateOf reads the held pages, then the index in the same run.
func (h *Handler) stateOf(ctx context.Context, id string) (pageState, error) {
	heldAnswer, err := h.Reader.Read(ctx, heldFile)
	if err != nil {
		return pageState{}, err
	}
	held, err := h.held.of(heldAnswer, heldIDs)
	if err != nil {
		return pageState{}, err
	}
	index, err := h.Reader.ReadIn(ctx, heldAnswer.RunID, indexFile)
	if err != nil {
		return pageState{}, err
	}
	pages, err := h.pages.of(index, pageIDs)
	if err != nil {
		return pageState{}, err
	}
	_, paged := pages[id]
	hasCopy, isHeld := held[id]
	return pageState{runID: heldAnswer.RunID, paged: paged, held: isHeld, hasCopy: hasCopy}, nil
}

func (h *Handler) serveIn(w http.ResponseWriter, r *http.Request, runID string, a artifact) {
	answer, err := h.Reader.ReadIn(r.Context(), runID, a)
	if err != nil {
		h.unavailable(w, r, err)
		return
	}
	h.respond(w, r, answer)
}

func (h *Handler) playerID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("id")
	if !playerIDPattern.MatchString(id) {
		httpx.WriteInvalid(w, r, map[string]string{"id": "a player id is word characters and hyphens"})
		return "", false
	}
	return id, h.ready(w, r)
}

func (h *Handler) noPage(w http.ResponseWriter, r *http.Request, message string) {
	httpx.WriteError(w, r, http.StatusNotFound, httpx.CodeNotFound, message, nil)
}

// pageIDs is every player id an index answer gives a page.
func pageIDs(index Answer) (map[string]struct{}, error) {
	var data struct {
		Pages []struct {
			ID string `json:"id"`
		} `json:"pages"`
	}
	if err := json.Unmarshal(index.Data, &data); err != nil {
		return nil, fmt.Errorf("runs: run %s index pages: %w", index.RunID, err)
	}
	ids := make(map[string]struct{}, len(data.Pages))
	for _, page := range data.Pages {
		ids[page.ID] = struct{}{}
	}
	return ids, nil
}

// heldIDs is every held page by id, true where an earlier run's copy is
// beside the run; empty on a run that held none.
func heldIDs(answer Answer) (map[string]bool, error) {
	var data struct {
		Held *apitypes.RunHeld `json:"held"`
	}
	if err := json.Unmarshal(answer.Data, &data); err != nil {
		return nil, fmt.Errorf("runs: run %s held pages: %w", answer.RunID, err)
	}
	held := map[string]bool{}
	if data.Held != nil {
		for _, page := range data.Held.Pages {
			held[page.Id] = page.Copy != nil
		}
	}
	return held, nil
}

// derived is a value worked out from one answer, kept until an answer
// with another ETag comes (a new run, or an hourly file read again).
type derived[T any] struct {
	mu    sync.Mutex
	tag   string
	value T
}

func (d *derived[T]) of(answer Answer, build func(Answer) (T, error)) (T, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.tag == answer.ETag {
		return d.value, nil
	}
	value, err := build(answer)
	if err != nil {
		var zero T
		return zero, err
	}
	d.tag, d.value = answer.ETag, value
	return value, nil
}
