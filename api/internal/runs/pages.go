package runs

import (
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"regexp"
	"slices"

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

// handlePlayer answers his page tonight. An id the run gives no page (a
// kicker, a defense, anyone the index does not list) is 404, and so is a
// held page: the gate refused tonight's document, so it is never sent;
// /run/held names his copy.
func (h *Handler) handlePlayer(w http.ResponseWriter, r *http.Request) {
	id, ok := h.playerID(w, r)
	if !ok {
		return
	}
	pages, err := h.pagesOf(r)
	if err != nil {
		h.unavailable(w, r, err)
		return
	}
	if !slices.Contains(pages, id) {
		h.noPage(w, r, "The run has no page for "+id+".")
		return
	}
	held, err := h.heldOf(r)
	if err != nil {
		h.unavailable(w, r, err)
		return
	}
	if _, isHeld := held[id]; isHeld {
		h.noPage(w, r, "His page is held this run. /run/held names his copy.")
		return
	}
	h.serve(w, r, playerFile(id))
}

// handleCopy answers a held page's copy from an earlier run, 404 for an
// id held.json does not list with a copy.
func (h *Handler) handleCopy(w http.ResponseWriter, r *http.Request) {
	id, ok := h.playerID(w, r)
	if !ok {
		return
	}
	held, err := h.heldOf(r)
	if err != nil {
		h.unavailable(w, r, err)
		return
	}
	if hasCopy, isHeld := held[id]; !isHeld || !hasCopy {
		h.noPage(w, r, "The run holds no copy of a page for "+id+".")
		return
	}
	h.serve(w, r, copyFile(id))
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

// pagesOf is every player id the index gives a page, so a player's key
// enters the cache only for a page the run has.
func (h *Handler) pagesOf(r *http.Request) ([]string, error) {
	index, err := h.Reader.Read(r.Context(), indexFile)
	if err != nil {
		return nil, err
	}
	var data struct {
		Pages []struct {
			ID string `json:"id"`
		} `json:"pages"`
	}
	if err := json.Unmarshal(index.Data, &data); err != nil {
		return nil, fmt.Errorf("runs: run %s index pages: %w", index.RunID, err)
	}
	ids := make([]string, len(data.Pages))
	for i, page := range data.Pages {
		ids[i] = page.ID
	}
	return ids, nil
}

// heldOf is every held page by id, true where an earlier run's copy is
// beside the run; empty on a run that held none.
func (h *Handler) heldOf(r *http.Request) (map[string]bool, error) {
	answer, err := h.Reader.Read(r.Context(), heldFile)
	if err != nil {
		return nil, err
	}
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
