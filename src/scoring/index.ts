export {
  computeFantasyPoints,
  scoreLineup,
  roundPoints,
  POINTS_ALLOWED_TIERS,
  SCORING_TIER_TABLES,
  pointsAllowedBands,
  pointsAllowedBandIndex,
  type PointsAllowedBand,
  type ScoringRules,
  type Starter,
  type ScoreLineupInput,
  type LineupScore,
} from "./compute";
export * from "./presets";
export { scoringHashOf } from "./hash";
export { describeScoring } from "./describe";
