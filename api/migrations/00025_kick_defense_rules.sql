-- +goose Up
-- Lane 70b: ScoringRules carries a kicker's longer field goals and a team
-- defense's points-allowed and yards-allowed tiers beside the 21 rules
-- research/model/domain.py names. Every custom scoring stored before this
-- gains them: the longer field goals at the scoring's own field goal figure
-- (what it scored them at until now) and the tiers at domain.py's standard
-- tables (what research scores a defense by). A league attached from a host
-- takes its host's own figures the next time it is attached. A league's
-- last host read is rewritten by its next read; its rules gain the same
-- figures meanwhile, so a saved league is never read with a rule missing.

-- +goose StatementBegin
create function app.kick_defense_rules_of(c jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'points_per_field_goal_40_49', coalesce((c->>'points_per_field_goal')::float8, 3),
    'points_per_field_goal_50_plus', coalesce((c->>'points_per_field_goal')::float8, 3),
    'points_allowed_0', 5,
    'points_allowed_1_6', 4,
    'points_allowed_7_13', 3,
    'points_allowed_14_17', 1,
    'points_allowed_18_20', 0,
    'points_allowed_21', 0,
    'points_allowed_22_27', 0,
    'points_allowed_28_34', -1,
    'points_allowed_35_45', -3,
    'points_allowed_46_plus', -5,
    'yards_allowed_0_99', 5,
    'yards_allowed_100_199', 3,
    'yards_allowed_200_299', 2,
    'yards_allowed_300_349', 0,
    'yards_allowed_350_399', -1,
    'yards_allowed_400_449', -3,
    'yards_allowed_450_499', -5,
    'yards_allowed_500_549', -6,
    'yards_allowed_550_plus', -7
  ) || c
$$;
-- +goose StatementEnd

update app.leagues set settings = jsonb_set(settings, '{scoring,custom}', app.kick_defense_rules_of(settings->'scoring'->'custom'))
  where jsonb_typeof(settings->'scoring'->'custom') = 'object';
update app.mocks set settings = jsonb_set(settings, '{scoring,custom}', app.kick_defense_rules_of(settings->'scoring'->'custom'))
  where jsonb_typeof(settings->'scoring'->'custom') = 'object';
update app.rooms set settings = jsonb_set(settings, '{scoring,custom}', app.kick_defense_rules_of(settings->'scoring'->'custom'))
  where jsonb_typeof(settings->'scoring'->'custom') = 'object';
update app.companions set settings = jsonb_set(settings, '{scoring,custom}', app.kick_defense_rules_of(settings->'scoring'->'custom'))
  where jsonb_typeof(settings->'scoring'->'custom') = 'object';
update app.league_snapshots set snapshot = jsonb_set(snapshot, '{scoring,rules}', app.kick_defense_rules_of(snapshot->'scoring'->'rules'))
  where jsonb_typeof(snapshot->'scoring'->'rules') = 'object' and snapshot->'scoring'->'rules' <> '{}'::jsonb;

drop function app.kick_defense_rules_of(jsonb);

-- +goose Down
update app.leagues set settings = jsonb_set(settings, '{scoring,custom}', (settings->'scoring'->'custom') - array['points_per_field_goal_40_49', 'points_per_field_goal_50_plus', 'points_allowed_0', 'points_allowed_1_6', 'points_allowed_7_13', 'points_allowed_14_17', 'points_allowed_18_20', 'points_allowed_21', 'points_allowed_22_27', 'points_allowed_28_34', 'points_allowed_35_45', 'points_allowed_46_plus', 'yards_allowed_0_99', 'yards_allowed_100_199', 'yards_allowed_200_299', 'yards_allowed_300_349', 'yards_allowed_350_399', 'yards_allowed_400_449', 'yards_allowed_450_499', 'yards_allowed_500_549', 'yards_allowed_550_plus'])
  where jsonb_typeof(settings->'scoring'->'custom') = 'object';
update app.mocks set settings = jsonb_set(settings, '{scoring,custom}', (settings->'scoring'->'custom') - array['points_per_field_goal_40_49', 'points_per_field_goal_50_plus', 'points_allowed_0', 'points_allowed_1_6', 'points_allowed_7_13', 'points_allowed_14_17', 'points_allowed_18_20', 'points_allowed_21', 'points_allowed_22_27', 'points_allowed_28_34', 'points_allowed_35_45', 'points_allowed_46_plus', 'yards_allowed_0_99', 'yards_allowed_100_199', 'yards_allowed_200_299', 'yards_allowed_300_349', 'yards_allowed_350_399', 'yards_allowed_400_449', 'yards_allowed_450_499', 'yards_allowed_500_549', 'yards_allowed_550_plus'])
  where jsonb_typeof(settings->'scoring'->'custom') = 'object';
update app.rooms set settings = jsonb_set(settings, '{scoring,custom}', (settings->'scoring'->'custom') - array['points_per_field_goal_40_49', 'points_per_field_goal_50_plus', 'points_allowed_0', 'points_allowed_1_6', 'points_allowed_7_13', 'points_allowed_14_17', 'points_allowed_18_20', 'points_allowed_21', 'points_allowed_22_27', 'points_allowed_28_34', 'points_allowed_35_45', 'points_allowed_46_plus', 'yards_allowed_0_99', 'yards_allowed_100_199', 'yards_allowed_200_299', 'yards_allowed_300_349', 'yards_allowed_350_399', 'yards_allowed_400_449', 'yards_allowed_450_499', 'yards_allowed_500_549', 'yards_allowed_550_plus'])
  where jsonb_typeof(settings->'scoring'->'custom') = 'object';
update app.companions set settings = jsonb_set(settings, '{scoring,custom}', (settings->'scoring'->'custom') - array['points_per_field_goal_40_49', 'points_per_field_goal_50_plus', 'points_allowed_0', 'points_allowed_1_6', 'points_allowed_7_13', 'points_allowed_14_17', 'points_allowed_18_20', 'points_allowed_21', 'points_allowed_22_27', 'points_allowed_28_34', 'points_allowed_35_45', 'points_allowed_46_plus', 'yards_allowed_0_99', 'yards_allowed_100_199', 'yards_allowed_200_299', 'yards_allowed_300_349', 'yards_allowed_350_399', 'yards_allowed_400_449', 'yards_allowed_450_499', 'yards_allowed_500_549', 'yards_allowed_550_plus'])
  where jsonb_typeof(settings->'scoring'->'custom') = 'object';
update app.league_snapshots set snapshot = jsonb_set(snapshot, '{scoring,rules}', (snapshot->'scoring'->'rules') - array['points_per_field_goal_40_49', 'points_per_field_goal_50_plus', 'points_allowed_0', 'points_allowed_1_6', 'points_allowed_7_13', 'points_allowed_14_17', 'points_allowed_18_20', 'points_allowed_21', 'points_allowed_22_27', 'points_allowed_28_34', 'points_allowed_35_45', 'points_allowed_46_plus', 'yards_allowed_0_99', 'yards_allowed_100_199', 'yards_allowed_200_299', 'yards_allowed_300_349', 'yards_allowed_350_399', 'yards_allowed_400_449', 'yards_allowed_450_499', 'yards_allowed_500_549', 'yards_allowed_550_plus'])
  where jsonb_typeof(snapshot->'scoring'->'rules') = 'object';
