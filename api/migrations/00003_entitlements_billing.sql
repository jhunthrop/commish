-- +goose Up
-- Entitlements and billing (spec §2.6). entitlements is the only thing
-- Can() reads: a Stripe payment, a subscription, a group pass claim and
-- a hand grant all land as rows here and look identical from there.

create table app.billing_customers (
  account_id         uuid primary key references app.accounts (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at         timestamptz not null default now()
);

-- A commissioner's purchase of N Draft Passes for one league. Each claim
-- through the link is one entitlements row pointing back here.
create table app.group_passes (
  id                         uuid primary key default gen_random_uuid(),
  purchaser_id               uuid not null references app.accounts (id) on delete restrict,
  league_name                text not null check (char_length(league_name) between 1 and 60),
  season                     smallint not null,
  seats                      smallint not null check (seats between 1 and 32),
  claim_code                 text not null unique check (char_length(claim_code) between 16 and 64),
  status                     text not null default 'active' check (status in ('active', 'refunded')),
  stripe_checkout_session_id text not null unique,
  stripe_payment_intent_id   text unique,
  created_at                 timestamptz not null default now()
);
create index group_passes_purchaser_idx on app.group_passes (purchaser_id, created_at desc);

create table app.entitlements (
  id                         bigint generated always as identity primary key,
  account_id                 uuid not null references app.accounts (id) on delete cascade,
  product                    text not null check (product in ('draft_pass', 'membership')),
  source                     text not null check (source in ('purchase', 'subscription', 'group_pass', 'grant')),
  status                     text not null check (status in (
                               'active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete',
                               'incomplete_expired', 'paused', 'refunded', 'revoked')),
  season                     smallint,
  starts_at                  timestamptz not null default now(),
  -- The moment access ends. A Draft Pass ends at its season's end; a
  -- subscription at its paid period's end plus the grace in
  -- internal/billing; a grant may have none.
  ends_at                    timestamptz,
  billing_interval           text check (billing_interval in ('year', 'month')),
  current_period_end         timestamptz,
  cancel_at_period_end       boolean not null default false,
  stripe_subscription_id     text unique,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id   text,
  group_pass_id              uuid references app.group_passes (id) on delete restrict,
  granted_by                 text not null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint entitlements_pass_has_season check (product <> 'draft_pass' or (season is not null and ends_at is not null)),
  constraint entitlements_subscription_has_id check (source <> 'subscription' or stripe_subscription_id is not null),
  constraint entitlements_group_pass_link check ((source = 'group_pass') = (group_pass_id is not null))
);
create index entitlements_account_idx on app.entitlements (account_id);
create unique index entitlements_group_claim_key on app.entitlements (group_pass_id, account_id) where group_pass_id is not null;
create index entitlements_payment_intent_idx on app.entitlements (stripe_payment_intent_id) where stripe_payment_intent_id is not null;
create index entitlements_renewal_idx on app.entitlements (current_period_end)
  where source = 'subscription' and status in ('active', 'trialing');
create trigger entitlements_touch before update on app.entitlements
  for each row execute function app.touch_updated_at();

-- What each product unlocks. Can() joins through this table, so what a
-- product grants is data with a migration history, not a code branch.
-- internal/entitlements spells the same snake_case features.
create table app.product_features (
  product text not null check (product in ('draft_pass', 'membership')),
  feature text not null,
  primary key (product, feature)
);
insert into app.product_features (product, feature) values
  ('draft_pass', 'live_draft_advisor'),
  ('draft_pass', 'custom_scoring'),
  ('membership', 'live_draft_advisor'),
  ('membership', 'custom_scoring'),
  ('membership', 'full_reasoning'),
  ('membership', 'range_of_outcomes'),
  ('membership', 'synced_sheet'),
  ('membership', 'early_run');

-- Every Stripe event, verified, kept whole. processed_at is the
-- idempotency gate: a redelivery of a processed event is a no-op.
create table app.billing_events (
  id           text primary key,
  type         text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz
);
create index billing_events_unprocessed_idx on app.billing_events (received_at) where processed_at is null;

-- One reminder per subscription per renewal, so a rerun of the job
-- never mails twice.
create table app.renewal_reminders (
  entitlement_id bigint not null references app.entitlements (id) on delete cascade,
  period_end     timestamptz not null,
  sent_at        timestamptz not null default now(),
  primary key (entitlement_id, period_end)
);
