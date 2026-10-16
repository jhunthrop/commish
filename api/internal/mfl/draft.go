package mfl

import (
	"context"
	"strings"
)

// maxDraftPicks bounds a league's draft results: every franchise's
// picks over a long draft.
const maxDraftPicks = maxTeams * 50

// DraftResults is how far a league's draft has gone: the picks its
// results list and how many carry a player. No picks is a league whose
// results state no draft (none set up, or one run off the host).
type DraftResults struct {
	Picks int
	Made  int
}

type wireDraftResults struct {
	DraftResults struct {
		DraftUnit list[struct {
			DraftPick list[struct {
				Player string `json:"player"`
			}] `json:"draftPick"`
		}] `json:"draftUnit"`
	} `json:"draftResults"`
}

// DraftResults reads the league's draft results (TYPE=draftResults).
func (c *Client) DraftResults(ctx context.Context, season int, id string) (DraftResults, error) {
	var w wireDraftResults
	if err := c.export(ctx, season, id, "draftResults", nil, maxBody, &w); err != nil {
		return DraftResults{}, err
	}
	return w.validate()
}

// DecodeDraftResults checks a draft results answer.
func DecodeDraftResults(body []byte) (DraftResults, error) {
	var w wireDraftResults
	if err := decode(body, &w); err != nil {
		return DraftResults{}, err
	}
	return w.validate()
}

func (w wireDraftResults) validate() (DraftResults, error) {
	var d DraftResults
	for _, unit := range w.DraftResults.DraftUnit {
		for _, p := range unit.DraftPick {
			d.Picks++
			if strings.TrimSpace(p.Player) != "" {
				d.Made++
			}
		}
	}
	if d.Picks > maxDraftPicks {
		return DraftResults{}, malformed("%d draft picks", d.Picks)
	}
	return d, nil
}
