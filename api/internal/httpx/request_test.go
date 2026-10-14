package httpx

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

func TestDecodeJSONRequiresJSONContentType(t *testing.T) {
	cases := []struct {
		name, contentType string
		want              int
	}{
		{"json", "application/json", http.StatusOK},
		{"json with charset", "application/json; charset=utf-8", http.StatusOK},
		{"form", "application/x-www-form-urlencoded", http.StatusUnsupportedMediaType},
		{"plain text", "text/plain", http.StatusUnsupportedMediaType},
		{"none", "", http.StatusUnsupportedMediaType},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/mocks", strings.NewReader(`{"a":1}`))
			if c.contentType != "" {
				r.Header.Set("Content-Type", c.contentType)
			}
			w := httptest.NewRecorder()
			var dst struct {
				A int `json:"a"`
			}
			if ok := DecodeJSON(w, r, MaxSmallBody, &dst); ok != (c.want == http.StatusOK) {
				t.Fatalf("DecodeJSON = %v", ok)
			}
			if c.want != http.StatusOK && w.Code != c.want {
				t.Fatalf("status = %d, want %d", w.Code, c.want)
			}
			if c.want == http.StatusOK && dst.A != 1 {
				t.Fatalf("decoded %+v", dst)
			}
		})
	}
}

// A league's rules with a key the 21 do not name answer 400 at that
// field, never as a body that is not JSON.
func TestDecodeJSONNamesAnUnknownScoringRule(t *testing.T) {
	body := `{"scoring":{"preset":null,"custom":{"points_per_carry":1}}}`
	r := httptest.NewRequest(http.MethodPost, "/leagues", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	var dst apitypes.LeagueSettings
	if DecodeJSON(w, r, MaxSmallBody, &dst) {
		t.Fatal("an unknown rule was read")
	}
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), `"scoring.custom.points_per_carry"`) {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
}
