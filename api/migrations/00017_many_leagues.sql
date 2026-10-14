-- +goose Up
-- Founder ruling 2026-10-13: following one league is free, following
-- more than one comes with the Draft Pass (and so with the Membership,
-- which carries every pass feature). Data, so Can answers it and the
-- pass page lists it.
insert into app.product_features (product, feature) values
  ('draft_pass', 'many_leagues'),
  ('membership', 'many_leagues');

-- +goose Down
delete from app.product_features where feature = 'many_leagues';
