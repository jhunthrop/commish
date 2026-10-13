package config

import "testing"

// SHARE_LINK_KEYS splits on spaces or commas, newest first, and refuses a
// key shorter than the cookie password's floor.
func TestSecrets(t *testing.T) {
	long1 := "first-share-key-0123456789abcdef-012345"
	long2 := "second-share-key-0123456789abcdef-01234"
	l := &loader{get: func(string) string { return long1 + ", " + long2 }}
	got := l.secrets("SHARE_LINK_KEYS")
	if len(got) != 2 || got[0] != long1 || got[1] != long2 || l.err() != nil {
		t.Fatalf("got %v, %v", got, l.err())
	}
	short := &loader{get: func(string) string { return "too-short" }}
	if keys := short.secrets("SHARE_LINK_KEYS"); len(keys) != 0 || short.err() == nil {
		t.Fatal("a short key was accepted")
	}
	empty := &loader{get: func(string) string { return "" }}
	if keys := empty.secrets("SHARE_LINK_KEYS"); len(keys) != 0 || empty.err() != nil {
		t.Fatal("an unset variable is not an empty list")
	}
}
