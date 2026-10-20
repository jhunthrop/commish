package leaguerecord

import (
	"context"

	"github.com/jhunthrop/commish/api/internal/boards"
	"github.com/jhunthrop/commish/api/internal/leaguesync"
)

// Orders is the register's set order for each week. *boards.PGSource
// implements it.
type Orders interface {
	SetOrders(ctx context.Context, season int) ([]boards.SetOrder, error)
}

// Service grades a member's ESPN league week by week from the reads the
// capture kept and the orders the register set.
type Service struct {
	Store  *Store
	Orders Orders
}

// Weeks is the member's team's graded weeks: none for a league on another
// platform, whose week reads are not kept.
func (s *Service) Weeks(ctx context.Context, snap leaguesync.Snapshot, me int, byes map[string]int) ([]Week, error) {
	if snap.Ref.Host != leaguesync.HostESPN || me == 0 {
		return nil, nil
	}
	orders, err := s.Orders.SetOrders(ctx, snap.Ref.Season)
	if err != nil || len(orders) == 0 {
		return nil, err
	}
	rows, err := s.Store.Reads(ctx, snap.Ref.LeagueID, snap.Ref.Season)
	if err != nil {
		return nil, err
	}
	return Grade(orders, rows, me, snap.Shape, byes), nil
}
