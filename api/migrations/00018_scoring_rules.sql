-- +goose Up
-- A league's own scoring is ScoringRules (Lane 8 part A): the 21 rules
-- research/model/domain.py names, every one stated, and the boards
-- service scores them exactly. A custom scoring saved before this was a
-- free map of points per stat, in ScoringRules' names (an attached league)
-- or Sleeper's (an older import), and the rooms only ever read its
-- reception points. Each stored one becomes the 21 rules: its own figure
-- under either name, the two-point trio and the return touchdowns from
-- the first Sleeper name it states, and the standard figure for a rule it
-- does not state. A saved league's settings_version moves to 2, the
-- version every league saved from now on is written at.

-- +goose StatementBegin
create function app.scoring_rules_of(c jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'points_per_passing_yard', coalesce((c->>'points_per_passing_yard')::float8, (c->>'pass_yd')::float8, 0.04),
    'points_per_passing_touchdown', coalesce((c->>'points_per_passing_touchdown')::float8, (c->>'pass_td')::float8, 4),
    'points_per_interception', coalesce((c->>'points_per_interception')::float8, (c->>'pass_int')::float8, -2),
    'points_per_rushing_yard', coalesce((c->>'points_per_rushing_yard')::float8, (c->>'rush_yd')::float8, 0.1),
    'points_per_rushing_touchdown', coalesce((c->>'points_per_rushing_touchdown')::float8, (c->>'rush_td')::float8, 6),
    'points_per_receiving_yard', coalesce((c->>'points_per_receiving_yard')::float8, (c->>'rec_yd')::float8, 0.1),
    'points_per_receiving_touchdown', coalesce((c->>'points_per_receiving_touchdown')::float8, (c->>'rec_td')::float8, 6),
    'points_per_reception', coalesce((c->>'points_per_reception')::float8, (c->>'rec')::float8, 0),
    'points_per_fumble_lost', coalesce((c->>'points_per_fumble_lost')::float8, (c->>'fum_lost')::float8, -2),
    'te_reception_bonus', coalesce((c->>'te_reception_bonus')::float8, (c->>'bonus_rec_te')::float8, 0),
    'points_per_field_goal', coalesce((c->>'points_per_field_goal')::float8, (c->>'fgm')::float8, 3),
    'points_per_extra_point', coalesce((c->>'points_per_extra_point')::float8, (c->>'xpm')::float8, 1),
    'points_per_sack', coalesce((c->>'points_per_sack')::float8, (c->>'sack')::float8, 1),
    'points_per_defensive_interception', coalesce((c->>'points_per_defensive_interception')::float8, (c->>'int')::float8, 2),
    'points_per_defensive_touchdown', coalesce((c->>'points_per_defensive_touchdown')::float8, (c->>'def_td')::float8, 6),
    'points_per_two_point_conversion', coalesce((c->>'points_per_two_point_conversion')::float8, (c->>'pass_2pt')::float8, (c->>'rush_2pt')::float8, (c->>'rec_2pt')::float8, 2),
    'points_per_field_goal_missed', coalesce((c->>'points_per_field_goal_missed')::float8, (c->>'fgmiss')::float8, -1),
    'points_per_extra_point_missed', coalesce((c->>'points_per_extra_point_missed')::float8, (c->>'xpmiss')::float8, 0),
    'points_per_return_touchdown', coalesce((c->>'points_per_return_touchdown')::float8, (c->>'kr_td')::float8, (c->>'pr_td')::float8, 6),
    'points_per_defensive_fumble_recovery', coalesce((c->>'points_per_defensive_fumble_recovery')::float8, (c->>'fum_rec')::float8, 2),
    'points_per_safety', coalesce((c->>'points_per_safety')::float8, (c->>'safe')::float8, 2)
  )
$$;
-- +goose StatementEnd

update app.leagues set settings = jsonb_set(settings, '{scoring,custom}', app.scoring_rules_of(settings->'scoring'->'custom')), settings_version = 2
  where jsonb_typeof(settings->'scoring'->'custom') = 'object';
update app.mocks set settings = jsonb_set(settings, '{scoring,custom}', app.scoring_rules_of(settings->'scoring'->'custom'))
  where jsonb_typeof(settings->'scoring'->'custom') = 'object';
update app.rooms set settings = jsonb_set(settings, '{scoring,custom}', app.scoring_rules_of(settings->'scoring'->'custom'))
  where jsonb_typeof(settings->'scoring'->'custom') = 'object';
update app.companions set settings = jsonb_set(settings, '{scoring,custom}', app.scoring_rules_of(settings->'scoring'->'custom'))
  where jsonb_typeof(settings->'scoring'->'custom') = 'object';

drop function app.scoring_rules_of(jsonb);
alter table app.leagues alter column settings_version set default 2;

-- +goose Down
-- The 21 rules are kept: they are a custom scoring the old free map read
-- too. Only the version marker goes back.
alter table app.leagues alter column settings_version set default 1;
update app.leagues set settings_version = 1 where settings_version = 2;
