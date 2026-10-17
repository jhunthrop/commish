package hosts

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The MyFantasyLeague consent words kept here are the page's, word for
// word, at the same version.
func TestMFLConsentWordsMatchThePage(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "web", "src", "lib", "hosts", "connection-words.ts"))
	if err != nil {
		t.Fatal(err)
	}
	page := regexp.MustCompile(`\s+`).ReplaceAllString(string(b), " ")
	if !strings.Contains(page, "MFL_CONSENT = '"+MFLConsentWords+"'") {
		t.Fatalf("the page's MFL_CONSENT is not %q", MFLConsentWords)
	}
	if !strings.Contains(page, "MFL_CONSENT_VERSION = 1;") || MFLConsentVersion != 1 {
		t.Fatal("the versions differ")
	}
}
