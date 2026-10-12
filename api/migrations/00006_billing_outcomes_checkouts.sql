-- +goose Up
-- Billing hardening (lane 3 review, fix round 1).

-- Every event keeps what became of it, and its payload holds only the
-- fields the handlers read (internal/billing trims it). After the
-- retention window the sweep job clears the payload; the row, its type,
-- its times and its outcome stay for the record.
alter table app.billing_events
  alter column payload drop not null,
  add column outcome        text check (outcome in ('applied', 'ignored', 'refunded_duplicate', 'ended_by_dispute', 'dispute_closed')),
  add column outcome_reason text,
  add column payload_cleared_at timestamptz;
create index billing_events_retention_idx on app.billing_events (received_at) where payload is not null;

-- A dispute ends what the disputed payment bought.
alter table app.entitlements drop constraint entitlements_status_check;
alter table app.entitlements add constraint entitlements_status_check check (status in (
  'active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete',
  'incomplete_expired', 'paused', 'refunded', 'revoked', 'disputed'));
alter table app.group_passes drop constraint group_passes_status_check;
alter table app.group_passes add constraint group_passes_status_check check (status in ('active', 'refunded', 'disputed'));

-- One open checkout per account, product and season (season 0 for the
-- Membership, which has none). A second request for the same thing
-- reuses the open session's link; a request for a different quantity
-- expires it at Stripe first. A completed or expired session is no
-- longer open, so it never blocks the next purchase.
create table app.checkout_sessions (
  stripe_checkout_session_id text primary key,
  account_id                 uuid not null references app.accounts (id) on delete cascade,
  product                    text not null check (product in ('draft_pass', 'membership', 'group_pass')),
  season                     smallint not null,
  lookup_key                 text not null,
  quantity                   integer not null check (quantity >= 1),
  url                        text not null,
  status                     text not null default 'open' check (status in ('open', 'completed', 'expired')),
  expires_at                 timestamptz not null,
  created_at                 timestamptz not null default now()
);
create unique index checkout_sessions_open_key on app.checkout_sessions (account_id, product, season) where status = 'open';
