// Package bots is the practice opponents, ported from src/mock-draft: the
// seeded generator, the seven archetypes and the one sampler every bot
// draws its pick from. Pure over the draft state and an Rng, so a room's
// stored seed replays its bots exactly.
package bots

import "unicode/utf16"

// Rng is mulberry32: a 32-bit state advanced by a fixed odd increment and
// mixed, bit for bit as the TypeScript computes it with Math.imul and
// unsigned shifts. Not safe for concurrent use; every stream is its own.
type Rng struct{ state uint32 }

// NewRng seeds a generator. The seed is taken modulo 2**32, as the
// TypeScript's `seed >>> 0` does.
func NewRng(seed uint32) *Rng { return &Rng{state: seed} }

// Next is the next value in [0, 1): a 32-bit integer over 2**32, exact.
func (r *Rng) Next() float64 {
	r.state += 0x6d2b79f5
	t := r.state
	t = (t ^ (t >> 15)) * (t | 1)
	t ^= t + (t^(t>>7))*(t|61)
	return float64(t^(t>>14)) / 4294967296
}

// SeedBits is a numeric seed as the TypeScript's 32-bit operators read it:
// ToInt32, which for a whole number is its value modulo 2**32.
func SeedBits(seed int64) uint32 { return uint32(seed) }

// seedForKey is FNV-1a over the key's UTF-16 code units, the seed folded
// in as the starting value.
func seedForKey(seed uint32, key string) uint32 {
	hash := 0x811c9dc5 ^ seed
	for _, unit := range utf16.Encode([]rune(key)) {
		hash ^= uint32(unit)
		hash *= 0x01000193
	}
	return hash
}

// RngFor is one independent stream per key from one draft seed: the same
// seed and key always draw the same sequence.
func RngFor(seed uint32, key string) *Rng { return NewRng(seedForKey(seed, key)) }

// Shuffle is a seeded Fisher-Yates over a copy; the input is untouched.
func Shuffle[T any](items []T, rng *Rng) []T {
	deck := append([]T(nil), items...)
	for i := len(deck) - 1; i > 0; i-- {
		j := int(rng.Next() * float64(i+1))
		deck[i], deck[j] = deck[j], deck[i]
	}
	return deck
}
