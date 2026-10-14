package entitlements

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ProductFeatures is what each product unlocks, read from
// app.product_features: the same rows Can joins through, so the pass
// page lists exactly what a purchase turns on. Features keep the
// contract's order (openapi.yaml's Feature enum).
func (s *Store) ProductFeatures(ctx context.Context) (map[Product][]Feature, error) {
	rows, err := s.Pool.Query(ctx, `select product, feature from app.product_features`)
	if err != nil {
		return nil, fmt.Errorf("entitlements: product features: %w", err)
	}
	type pair struct{ product, feature string }
	pairs, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (pair, error) {
		var p pair
		err := r.Scan(&p.product, &p.feature)
		return p, err
	})
	if err != nil {
		return nil, fmt.Errorf("entitlements: product features: %w", err)
	}
	has := map[Product]map[Feature]bool{}
	for _, p := range pairs {
		if has[Product(p.product)] == nil {
			has[Product(p.product)] = map[Feature]bool{}
		}
		has[Product(p.product)][Feature(p.feature)] = true
	}
	out := map[Product][]Feature{}
	for product, set := range has {
		for _, f := range AllFeatures() {
			if set[f] {
				out[product] = append(out[product], f)
			}
		}
	}
	return out, nil
}

// AllFeatures is every feature in the contract's order.
func AllFeatures() []Feature {
	return []Feature{LiveDraftAdvisor, CustomScoring, FullReasoning, RangeOfOutcomes, SyncedSheet, EarlyRun, StartSit, WaiverRanks, TradeFinder, ManyLeagues}
}
