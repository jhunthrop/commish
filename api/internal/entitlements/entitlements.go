// Package entitlements answers "may this account use this feature right
// now" from the app.entitlements and app.product_features tables, and
// nothing else (spec §2.6). It has no Stripe dependency and no opinion
// about how a row got there: a payment, a subscription, a group pass
// claim and a hand grant all look identical from Can. It is also the
// only writer of app.entitlements; billing calls in here.
package entitlements

import (
	"time"

	"github.com/jhunthrop/commish/api/internal/apitypes"
)

// Feature is one gated capability, spelled in snake_case exactly as the
// contract (openapi.yaml) and app.product_features spell it.
type Feature = apitypes.Feature

// The features, from spec §2.6.
const (
	LiveDraftAdvisor = apitypes.FeatureLiveDraftAdvisor
	CustomScoring    = apitypes.FeatureCustomScoring
	FullReasoning    = apitypes.FeatureFullReasoning
	RangeOfOutcomes  = apitypes.FeatureRangeOfOutcomes
	SyncedSheet      = apitypes.FeatureSyncedSheet
	EarlyRun         = apitypes.FeatureEarlyRun
	// The in-season tier (spec §2.9), granted by the Membership. Data
	// only until their tools ship (Lane 13): nothing checks them yet.
	StartSit    = apitypes.FeatureStartSit
	WaiverRanks = apitypes.FeatureWaiverRanks
	TradeFinder = apitypes.FeatureTradeFinder
)

// Product is what a row grants. app.product_features maps it to
// features. A group pass claim grants a draft_pass.
type Product string

const (
	ProductDraftPass  Product = "draft_pass"
	ProductMembership Product = "membership"
)

// Source is how a row came to be.
type Source string

const (
	SourcePurchase     Source = "purchase"
	SourceSubscription Source = "subscription"
	SourceGroupPass    Source = "group_pass"
	SourceGrant        Source = "grant"
)

// Status values outside Stripe's own subscription statuses.
const (
	StatusActive   = "active"
	StatusRefunded = "refunded"
	StatusRevoked  = "revoked"
)

// liveStatuses keep every feature on: a subscription still inside
// Stripe's trial or payment-retry window counts.
const liveStatuses = `('active', 'trialing', 'past_due')`

// SubscriptionGrace is how long past a paid period's end access lasts,
// so a renewal whose webhook is late (the nightly reconcile heals it)
// never locks a paying member out.
const SubscriptionGrace = 3 * 24 * time.Hour
