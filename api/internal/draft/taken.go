package draft

// Taken is which board positions of one pool are already drafted: a bit
// per position, built from the picks in one pass, so a scan of the board
// asks a bit instead of hashing every id.
type Taken struct {
	pool Pool
	bits []uint64
}

// TakenOn is s's drafted players, positioned on s's own pool.
func TakenOn(s State) Taken {
	t := Taken{pool: s.Pool, bits: make([]uint64, (s.Pool.Len()+63)/64)}
	for _, p := range s.Picks {
		if i, ok := s.Pool.index[p.PlayerID]; ok {
			t.bits[i/64] |= 1 << (i % 64)
		}
	}
	return t
}

// At is whether the entry at board index i is drafted.
func (t Taken) At(i int) bool { return t.bits[i/64]&(1<<(i%64)) != 0 }

// Has is whether a pooled player is drafted; false for an id off the pool.
func (t Taken) Has(playerID string) bool {
	i, ok := t.pool.index[playerID]
	return ok && t.At(i)
}

// Count is how many pooled players are drafted.
func (t Taken) Count() int {
	n := 0
	for _, w := range t.bits {
		for ; w != 0; w &= w - 1 {
			n++
		}
	}
	return n
}
