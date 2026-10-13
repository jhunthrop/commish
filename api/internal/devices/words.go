package devices

import (
	"crypto/rand"
	"crypto/sha256"
	_ "embed"
	"fmt"
	"regexp"
	"strings"
	"sync"
)

// A pairing code is CodeWords words from the embedded list of 256, so
// one word is one random byte and a code is 48 bits: at the pairing
// route's limit a guesser has no real chance inside the ten minutes a
// code lives, and the code is typed, not pasted, so it stays short words.
const (
	CodeWords = 6
	listSize  = 256
)

//go:embed words.txt
var wordsFile string

var wordShape = regexp.MustCompile(`^[a-z]{3,8}$`)

var (
	wordsOnce sync.Once
	wordList  []string
	wordSet   map[string]bool
	wordsErr  error
)

// words is the parsed list, checked once: 256 unique short lowercase words.
func words() ([]string, map[string]bool, error) {
	wordsOnce.Do(func() {
		list := strings.Fields(wordsFile)
		set := make(map[string]bool, len(list))
		for _, w := range list {
			if !wordShape.MatchString(w) || set[w] {
				wordsErr = fmt.Errorf("devices: word list entry %q", w)
				return
			}
			set[w] = true
		}
		if len(list) != listSize {
			wordsErr = fmt.Errorf("devices: word list has %d words, want %d", len(list), listSize)
			return
		}
		wordList, wordSet = list, set
	})
	return wordList, wordSet, wordsErr
}

// NewCode is a fresh pairing code, its words joined by spaces.
func NewCode() (string, error) {
	list, _, err := words()
	if err != nil {
		return "", err
	}
	b := make([]byte, CodeWords)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("devices: code: %w", err)
	}
	out := make([]string, CodeWords)
	for i, n := range b {
		out[i] = list[n]
	}
	return strings.Join(out, " "), nil
}

// NormalizeCode is a typed code as NewCode wrote it: any case, any
// spacing or punctuation between the words. ok is false unless it is
// exactly CodeWords words from the list.
func NormalizeCode(typed string) (string, bool) {
	_, set, err := words()
	if err != nil || len(typed) > 200 {
		return "", false
	}
	parts := strings.FieldsFunc(strings.ToLower(typed), func(r rune) bool { return r < 'a' || r > 'z' })
	if len(parts) != CodeWords {
		return "", false
	}
	for _, p := range parts {
		if !set[p] {
			return "", false
		}
	}
	return strings.Join(parts, " "), true
}

// codeHash is the stored form of a normalized code.
func codeHash(code string) []byte {
	sum := sha256.Sum256([]byte("pair:" + code))
	return sum[:]
}
