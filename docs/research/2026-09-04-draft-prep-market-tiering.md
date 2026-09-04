# Draft-prep market research: how to tier Draft HQ

2026-09-04 · three-track web research (incumbent tiering, paid field, free baseline + willingness to pay). Competitor names appear in this internal doc for scoping only; none appear in product copy (standing rule).

## Findings

**1. The free baseline is high and rising.** Consensus rankings, ADP, positional/superflex cuts, printable cheat sheets, and realistic mock simulators are free on every major platform (Sleeper, ESPN, Yahoo, NFL.com, Underdog). Gating any of these alone reads as a bad deal and, on a real-money platform, as exploiting a captive audience.

**2. The incumbents' paid gates cluster on two things**: live-sync in-draft assistance (the market leader's biggest gate AND its most-resented one: free all summer, "manual entry only" the moment your real draft starts, ~$6-17/mo to sync) and custom-scoring recompute / cheat-sheet customization. Every serious paid product now has both, so at the paid tier they are table stakes, not differentiators.

**3. Prices**: draft-only seasonal products $10-55; mainstream annual subs $60-120; all-access bundles $150-650. A serious-but-amateur manager's realistic tools budget is $0-150/yr against ~$287/season in entry fees. The converting pitch across testimonials is ROI against winnings ("paid for itself 20x"), never content quality.

**4. Accuracy marketing is downstream of one authority.** Nearly every "most accurate" claim in the market cites a single third-party contest; nobody runs their own audited measurement. One incumbent leans on named-expert credentials; another on proprietary grades; the AI newcomers claim nothing. A self-run, pre-registered, held-out-year accuracy register is a structurally different claim no one in the field makes.

**5. The structural facts unique to us**: we own the draft room (live sync is not a feature, it is the floor we stand on); our sim runs the real engine with need-aware bots (instant Monte Carlo over whole drafts, which no browser-extension product can do); our revenue is league entry, not subscriptions.

## Recommendation: free is the weapon, premium is the laboratory

**Free for every Commish user — the entire daily-use prep suite:**
- The Board, fully league-aware with the evidence drawer and receipts (their paid gate, our free hook)
- My Sheet complete (editor, seeding, room sync, print)
- Unlimited mocks, and the Assistant in every Commish room (we win draft day on the exact gate users resent most)
- Playbook fundamentals, player capsules, the market edges table
- The accuracy register page: free, loud, linked from every `why` — it is marketing, never inventory

Rationale: prep is customer acquisition for real-money leagues. A manager who preps here drafts here; a manager who drafts here plays here. Draft HQ free undercuts the entire paid field at their strongest gate and feeds the house-league funnel, where the actual business is.

**Premium ("the laboratory" tier, name TBD) — compute and power, ROI-framed:**
- The Simulator's heavy tier: 10k runs, find-my-best-slot, pick-path explorer, exposure reports, auction sims (1k-run basic sims stay free so everyone tastes it)
- Market alerts, value windows by room sharpness, full ADP history
- Pro data: CSV export everywhere, multi-sheet portfolios across many leagues, API access later
- Post-draft: full grade breakdowns and projected standings for every team in the league (the one-line grade stays free)

**Pricing posture:** seasonal, cheap against entry fees, ROI-framed. Anchor ~$39-49/season, with a bundle lever: premium included with meaningful entry-fee volume (e.g. active paid-league membership), making the tier a loyalty amplifier rather than a tollbooth. Never monthly-during-draft-season pricing that converts on resentment.

**What we never do** (inversions of the field's mistakes): no gate between a manager and their live draft; no settings-locked free simulator; no league-count caps; no trial-less paywall; no accuracy claim we did not measure ourselves.

## Effect on the Draft HQ spec

Answers open question 1 (base vs paid): Draft HQ ships in the base product; premium anchors on Simulator depth, alerts, and pro data. Phasing unchanged; the premium boundary is a config concern (run budgets, alert quotas), not an architectural one — build everything, meter the heavy compute.
