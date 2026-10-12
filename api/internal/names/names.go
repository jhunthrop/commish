// Package names is the one filter every public name passes: account
// handles and the handles shown in lobbies (spec §9). A name is 3 to 20
// letters, digits or underscores, does not start with a digit, and is
// not on the blocklist in blocklist.txt.
package names

import (
	_ "embed"
	"fmt"
	"regexp"
	"strings"
)

// Length bounds, the same in openapi.yaml's AccountUpdate and the
// accounts table's check.
const (
	MinLen = 3
	MaxLen = 20
)

// Refusal is why a name is refused. Its text is shown to the drafter
// as it is, so it follows the copy rules.
type Refusal string

func (r Refusal) Error() string { return string(r) }

// The reasons a name is refused.
const (
	ErrLength  Refusal = "Pick a name from 3 to 20 characters"
	ErrChars   Refusal = "Use letters, digits and underscores only"
	ErrDigit   Refusal = "Start with a letter or an underscore"
	ErrBlocked Refusal = "That name is not available"
)

var shape = regexp.MustCompile(`^[A-Za-z0-9_]+$`)

//go:embed blocklist.txt
var blocklistFile string

// Filter holds the parsed blocklist. Build one with Parse or Default.
type Filter struct {
	exact    map[string]bool
	contains []string
}

// Default is the filter built from the embedded blocklist.txt.
func Default() *Filter {
	f, err := Parse(blocklistFile)
	if err != nil {
		panic(fmt.Sprintf("names: embedded blocklist: %v", err))
	}
	return f
}

// Parse reads a blocklist in blocklist.txt's format.
func Parse(src string) (*Filter, error) {
	f := &Filter{exact: map[string]bool{}}
	for i, line := range strings.Split(src, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		word, isExact := strings.CutPrefix(line, "exact:")
		word = fold(word)
		if word == "" {
			return nil, fmt.Errorf("names: blocklist line %d is empty after folding", i+1)
		}
		if isExact {
			f.exact[word] = true
		} else {
			f.contains = append(f.contains, word)
		}
	}
	return f, nil
}

// lookalikes folds the digits people use for letters, so "sh1t" reads
// as the word it spells.
var lookalikes = strings.NewReplacer("0", "o", "1", "i", "3", "e", "4", "a", "5", "s", "7", "t", "8", "b", "9", "g")

// fold lowercases, maps look-alike digits to letters and drops
// underscores, so "Sh_1T" and "shit" compare equal.
func fold(s string) string {
	return lookalikes.Replace(strings.ReplaceAll(strings.ToLower(s), "_", ""))
}

// Check returns nil for an acceptable name, or the reason it is not.
func (f *Filter) Check(name string) error {
	if n := len(name); n < MinLen || n > MaxLen {
		return ErrLength
	}
	if !shape.MatchString(name) {
		return ErrChars
	}
	if name[0] >= '0' && name[0] <= '9' {
		return ErrDigit
	}
	folded := fold(name)
	if f.exact[folded] {
		return ErrBlocked
	}
	for _, w := range f.contains {
		if strings.Contains(folded, w) {
			return ErrBlocked
		}
	}
	return nil
}
