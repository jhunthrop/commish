// Package memo keeps answers that depend only on their key, bounded: past
// MaxEntries the memo starts over. Twelve viewers asking at once cost one
// computation each, and a process never holds more than the bound.
package memo

import "sync"

// MaxEntries bounds a memo.
const MaxEntries = 512

// Map is a bounded memo. The zero value is ready.
type Map[K comparable, V any] struct {
	mu      sync.Mutex
	entries map[K]V
}

// Get is the value kept for k.
func (m *Map[K, V]) Get(k K) (V, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.entries[k]
	return v, ok
}

// Put keeps v for k.
func (m *Map[K, V]) Put(k K, v V) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.entries == nil || len(m.entries) >= MaxEntries {
		m.entries = map[K]V{}
	}
	m.entries[k] = v
}
