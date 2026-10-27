package boards

import (
	"context"
	"strconv"

	"github.com/jhunthrop/commish/api/internal/headshots"
)

// faceRead is how a directory read learns which players have a face: our
// copy of their headshot for the season (research.headshot_copies, research
// revision 0022, Lane 241). Off when the table is absent or unreadable (an
// api deployed ahead of the migration): then no player has a face, never the
// provider's image.
type faceRead struct {
	on     bool
	season int
}

// faces is the read for this source's season.
func (s *PGSource) faces(ctx context.Context) (faceRead, error) {
	on, err := s.readable(ctx, headshots.Table)
	if err != nil {
		return faceRead{}, err
	}
	return faceRead{on: on, season: s.Season}, nil
}

// join is the ledger's row for the player, a face's alone; empty when off.
func (fr faceRead) join(s *PGSource) string {
	if !fr.on {
		return ""
	}
	return ` left join ` + s.table(headshots.Table) + ` face on face.season = ` + strconv.Itoa(fr.season) +
		` and face.player_id = pp.id and face.status in ` + headshots.FaceStatuses
}

// column is whether the player has a face, the column a read scans for it.
func (fr faceRead) column() string {
	if !fr.on {
		return "false"
	}
	return "face.player_id is not null"
}

// face is the player's headshot as the api answers it: our copy's address,
// "" without one.
func (fr faceRead) face(id string, has bool) string {
	if !has {
		return ""
	}
	return headshots.URL(fr.season, id)
}
