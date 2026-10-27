package headshots

import "testing"

func TestURL(t *testing.T) {
	cases := []struct {
		season int
		id     string
		want   string
	}{
		// Research (test_headshots.py) and the web (headshot.test.ts) pin this same URL.
		{2026, "4429795", "https://images.trycommish.app/headshots/2026/4429795/320.webp"},
		{2027, "1", "https://images.trycommish.app/headshots/2027/1/320.webp"},
		{2026, "team-def:KC", ""},
		{2026, "", ""},
		{2026, "../4429795", ""},
	}
	for _, c := range cases {
		if got := URL(c.season, c.id); got != c.want {
			t.Errorf("URL(%d, %q) = %q, want %q", c.season, c.id, got, c.want)
		}
	}
}

func TestStored(t *testing.T) {
	ours := "https://images.trycommish.app/headshots/2026/4429795/320.webp"
	cases := []struct {
		name string
		in   *string
		want *string
	}{
		{"none", nil, nil},
		{"ours as it is", &ours, &ours},
		{"the provider's NFL headshot moves to ours", ptr("https://a.espncdn.com/i/headshots/nfl/players/full/4429795.png"), &ours},
		{"a college one too", ptr("https://a.espncdn.com/i/headshots/college-football/players/full/4429795.png"), &ours},
		{"the provider's placeholder is no face", ptr("https://a.espncdn.com/combiner/i?img=/i/headshots/nophoto.png&w=200&h=146"), nil},
		{"any other host is no face", ptr("https://example.com/headshots/2026/4429795/320.webp"), nil},
	}
	for _, c := range cases {
		got := Stored(2026, c.in)
		if (got == nil) != (c.want == nil) || (got != nil && *got != *c.want) {
			t.Errorf("%s: Stored = %v, want %v", c.name, deref(got), deref(c.want))
		}
	}
}

func ptr(s string) *string { return &s }

func deref(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}
