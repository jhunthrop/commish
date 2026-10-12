"""THE MODEL (phase B, then C).

Phase B lands the projections fit, its validation and the backtests here, ported from the
TypeScript core's `src/projections/{model,preseason,market,backtest}`. It replaces the TypeScript
fit only after it reproduces the stored projections for every player-week of the 2026 register
within a stated tolerance, with every difference listed by cause, and from its switch date it
stamps `register_freeze_rows.implementation = 'python'`.

Phase C adds the decide layer beside it: survival and the pick recommendation.
"""
