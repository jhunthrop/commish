package leaguesync

import (
	"context"
	"strings"
)

// Host is one league host: how its links read, how one whole read of a
// league comes back, how a seat is found by username, and its player
// directory.
type Host interface {
	// Key is the host's contract name: "sleeper" or "mfl".
	Key() string
	// Owns reports whether pasted text is this host's address, so the
	// right parser is trusted with it.
	Owns(pasted string) bool
	// Parse reads a league out of pasted text. Only ids leave it.
	Parse(pasted string) (Ref, error)
	// Read is one whole upstream read of the league.
	Read(ctx context.Context, ref Ref) (Snapshot, error)
	// SeatByUsername is the roster the username runs, or ErrNoSeat, or
	// ErrSeatByName for a host with no public usernames.
	SeatByUsername(ctx context.Context, snap Snapshot, username string) (int, error)
	// Players is the host's player directory for a season.
	Players(ctx context.Context, season int) ([]HostPlayer, error)
}

// HostPlayer is one player in a host's directory.
type HostPlayer struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Position string `json:"position"`
	Team     string `json:"team"`
	// ESPNID is the player's ESPN id, the key our board's ids share.
	ESPNID string `json:"espn_id,omitempty"`
	// InjuredReserve says the host marks him IR beside his name.
	InjuredReserve bool `json:"injured_reserve,omitempty"`
}

// Hosts are the hosts a link may name, in the order they are tried.
type Hosts []Host

// Resolve is the host and league a link names. hostKey, when set, must
// be the host the link belongs to; a bare id is read as the first host's
// (Sleeper's), whose ids are what drafters paste bare.
func (hs Hosts) Resolve(hostKey, pasted string) (Host, Ref, error) {
	hostKey = strings.TrimSpace(hostKey)
	for _, h := range hs {
		if hostKey != "" && h.Key() != hostKey {
			continue
		}
		if hostKey == "" && !h.Owns(pasted) {
			continue
		}
		ref, err := h.Parse(pasted)
		if err != nil {
			return nil, Ref{}, ErrNotALink
		}
		return h, ref, nil
	}
	if hostKey == "" && len(hs) > 0 {
		if ref, err := hs[0].Parse(pasted); err == nil {
			return hs[0], ref, nil
		}
	}
	return nil, Ref{}, ErrNotALink
}

// ByKey is the host with the key.
func (hs Hosts) ByKey(key string) (Host, bool) {
	for _, h := range hs {
		if h.Key() == key {
			return h, true
		}
	}
	return nil, false
}
