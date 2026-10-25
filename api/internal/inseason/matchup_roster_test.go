package inseason

import (
	"bytes"
	"encoding/json"
	"net/http"
	"reflect"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
	"github.com/jhunthrop/commish/api/internal/httpx"
)

// matchupAt is the matchup route's box at path, failing the test on any
// other answer.
func matchupAt(t *testing.T, s *Service, path string) (apitypes.MatchupBox, json.RawMessage) {
	t.Helper()
	code, env := serve(t, s, leaguePath+path)
	if code != http.StatusOK || !env.Ok {
		t.Fatalf("%s: %d %+v", path, code, env.Error)
	}
	var box apitypes.MatchupBox
	if err := json.Unmarshal(env.Data, &box); err != nil {
		t.Fatal(err)
	}
	return box, env.Data
}

// The member's answer is the same bytes with ?roster= absent and naming
// their own roster, and says it is theirs (Lane 204).
func TestMatchupForTheMembersOwnRosterIsUnchanged(t *testing.T) {
	f, projection := liveFixture(t)
	s := liveService(t, f, projection)
	plain, plainBytes := matchupAt(t, s, "matchup")
	_, ownBytes := matchupAt(t, s, "matchup?roster=1")
	if !bytes.Equal(plainBytes, ownBytes) {
		t.Fatalf("the member's answer differs with their roster asked:\n%s\n%s", plainBytes, ownBytes)
	}
	if plain.ViewerSide == nil || *plain.ViewerSide != apitypes.MatchupBoxViewerSideMine {
		t.Fatalf("viewer_side %v", plain.ViewerSide)
	}
	if plain.Standing == nil {
		t.Fatal("the member's game under way carries no standing")
	}
}

// Another roster's game is the same two sides by the same rules, that
// roster's first, said to be another team's, with no standing (the
// member's words) and the same decided (Lane 204).
func TestMatchupForAnotherRosterIsTheirGame(t *testing.T) {
	f, projection := liveFixture(t)
	namedOpponents(&f)
	finishTeam(&f, "CIN", "CLE")
	f.league.Snap.Matchups[0].Points = 30
	s := liveService(t, f, projection)
	mine, _ := matchupAt(t, s, "matchup")
	theirs, _ := matchupAt(t, s, "matchup?roster=2")
	if theirs.ViewerSide == nil || *theirs.ViewerSide != apitypes.MatchupBoxViewerSideOther {
		t.Fatalf("viewer_side %v", theirs.ViewerSide)
	}
	if len(theirs.Sides) != 2 || theirs.Sides[0].RosterId != 2 || theirs.Sides[1].RosterId != 1 {
		t.Fatalf("sides %+v", theirs.Sides)
	}
	if !reflect.DeepEqual(theirs.Sides[0], mine.Sides[1]) || !reflect.DeepEqual(theirs.Sides[1], mine.Sides[0]) {
		t.Fatalf("another roster's sides are not the member's game's, swapped:\n%+v\n%+v", theirs.Sides, mine.Sides)
	}
	if theirs.Standing != nil {
		t.Fatalf("another team's game carries the member's standing %q", *theirs.Standing)
	}
	if mine.Decided == nil || theirs.Decided == nil || *mine.Decided != *theirs.Decided || !*theirs.Decided {
		t.Fatalf("decided: mine %v, theirs %v", mine.Decided, theirs.Decided)
	}
	if theirs.Week != mine.Week || theirs.ProjectionScoring != mine.ProjectionScoring {
		t.Fatalf("head %+v, the member's %+v", theirs, mine)
	}
}

// A roster with no opponent this week is its side alone.
func TestMatchupForARosterWithoutAGame(t *testing.T) {
	f := pairedFixture(t)
	box, _ := matchupAt(t, fixtureService(t, f.league, f.data, &fakeHolds{}), "matchup?roster=3")
	if len(box.Sides) != 1 || box.Sides[0].RosterId != 3 || box.Standing != nil {
		t.Fatalf("box %+v", box)
	}
}

// A roster that is not a whole number is refused before the league is
// read; one the league's read does not list is not found; each names the
// field (Lane 204).
func TestMatchupRosterRefusals(t *testing.T) {
	f := pairedFixture(t)
	s := fixtureService(t, f.league, f.data, &fakeHolds{})
	for _, c := range []struct {
		path string
		code int
		err  string
	}{
		{"matchup?roster=two", http.StatusBadRequest, httpx.CodeInvalid},
		{"matchup?roster=", http.StatusBadRequest, httpx.CodeInvalid},
		{"matchup?roster=-2", http.StatusBadRequest, httpx.CodeInvalid},
		{"matchup?roster=1.5", http.StatusBadRequest, httpx.CodeInvalid},
		{"matchup?roster=1234567890", http.StatusBadRequest, httpx.CodeInvalid},
		{"matchup?roster=%2B1", http.StatusBadRequest, httpx.CodeInvalid},
		{"matchup?roster=42", http.StatusNotFound, httpx.CodeNotFound},
	} {
		code, env := serve(t, s, leaguePath+c.path)
		if code != c.code || env.Ok || env.Error == nil || env.Error.Code != c.err {
			t.Fatalf("%s: %d %+v", c.path, code, env.Error)
		}
		words := gameRosterWords
		if c.code == http.StatusBadRequest {
			words = notRosterWords
		}
		if env.Error.Fields[fieldGameRoster] != words {
			t.Fatalf("%s: fields %v", c.path, env.Error.Fields)
		}
	}
}
