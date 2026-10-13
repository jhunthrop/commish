# Commish: the approved design authority (2026-10-12)

The shared brief is `brief.md`; the screens are the `.html` files; the token set is `tokens.css`, which `web/src/lib/ui/tokens.css` copies value for value.

- 2026-10-12, Lane 5: each font stack names a metric-matched fallback second ("Outfit Fallback" and the like, defined in `web/src/lib/ui/fonts/ui.css`), so text painted before the web font lands keeps its size when the font swaps in, which took the font-swap layout shift on the player and record pages out of the CLS budget.
