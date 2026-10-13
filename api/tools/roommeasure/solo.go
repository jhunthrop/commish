package main

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// measureSolo drafts mocks start to finish the way the room does: read
// the card at each turn, take a pick, read the report at the end. A pick
// is the first legal player in the order drafters take them, the
// card's call when it has one.
func measureSolo(ctx context.Context, env environment, mocks int, anon bool) error {
	d, err := soloDrafter(ctx, env, anon)
	if err != nil {
		return err
	}
	var creates, cards, picks, reports, computed []time.Duration
	for m := 0; m < mocks; m++ {
		slot := 1 + m%12
		preset := apitypes.ScoringPresetPpr
		in := apitypes.MockCreate{Settings: &apitypes.LeagueSettings{
			Scoring: apitypes.Scoring{Preset: &preset}, Teams: 12, Slot: &slot, Lineup: apitypes.LineupStandard,
			Roster:  apitypes.RosterCounts{Qb: 1, Rb: 2, Wr: 2, Te: 1, K: 1, Dst: 1, Bench: 6},
			Keepers: []apitypes.Keeper{}, BotStyle: apitypes.BotStyleAdp,
		}}
		seed := int64(20261012 + m)
		in.Seed = &seed
		var room apitypes.MockRoom
		_, took, err := d.call(ctx, http.MethodPost, "/mocks", in, &room)
		if err != nil {
			return err
		}
		creates = append(creates, took)
		board := room.Board.Players
		path := "/mocks/" + room.Id.String()
		for room.Waiting {
			var card apitypes.RoomCard
			_, took, err := d.call(ctx, http.MethodGet, path+"/card", nil, &card)
			if err != nil {
				return err
			}
			cards = append(cards, took)
			drafted := map[string]bool{}
			for _, p := range room.Picks {
				drafted[p.PlayerId] = true
			}
			order := append([]string{card.Call}, ids(board)...)
			picked := false
			for _, id := range order {
				if drafted[id] {
					continue
				}
				var next apitypes.MockRoom
				status, took, err := d.call(ctx, http.MethodPost, path+"/picks", apitypes.MockPickInput{PlayerId: id, Pick: room.PickNumber}, &next)
				if status == http.StatusUnprocessableEntity {
					continue
				}
				if err != nil {
					return err
				}
				picks = append(picks, took)
				room.Picks, room.PickNumber, room.Waiting = next.Picks, next.PickNumber, next.Waiting
				picked = true
				break
			}
			if !picked {
				return fmt.Errorf("mock %s: no legal pick at %d", room.Id, room.PickNumber)
			}
		}
		var report apitypes.MockReport
		_, took, err = d.call(ctx, http.MethodGet, path+"/report", nil, &report)
		if err != nil {
			return err
		}
		reports = append(reports, took)
		computed = append(computed, time.Duration(report.ComputedMs)*time.Millisecond)
	}
	line("create (bot picks to the first turn)", summarize(creates))
	line("card (advisor or the engine's 200 runs)", summarize(cards))
	line("pick round trip (pick, batch, persistence)", summarize(picks))
	line("report, first read (wall)", summarize(reports))
	line("report, computed on the server", summarize(computed))
	return nil
}

func ids(players []apitypes.BoardPlayer) []string {
	out := make([]string, len(players))
	for i, p := range players {
		out[i] = p.Id
	}
	return out
}
