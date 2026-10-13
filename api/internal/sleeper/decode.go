package sleeper

import "encoding/json"

// DecodeDraft checks a recorded GET /draft/{id} answer the way a live one
// is checked: the development replay's fixture.
func DecodeDraft(body []byte, id string) (Draft, error) {
	var w wireDraft
	if err := json.Unmarshal(body, &w); err != nil {
		return Draft{}, malformed("%v", err)
	}
	return w.validate(id)
}

// DecodePicks checks a recorded GET /draft/{id}/picks answer.
func DecodePicks(body []byte, teams, rounds int) ([]Pick, error) {
	var w []wirePick
	if err := json.Unmarshal(body, &w); err != nil {
		return nil, malformed("%v", err)
	}
	return validatePicks(w, teams, rounds)
}

// DecodeLeague checks a recorded GET /league/{id} answer.
func DecodeLeague(body []byte, id string) (League, error) {
	var w wireLeague
	if err := json.Unmarshal(body, &w); err != nil {
		return League{}, malformed("%v", err)
	}
	return w.validate(id)
}
