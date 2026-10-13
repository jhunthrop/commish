package httpx

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
