# Brand and styling mocks for the prep site: shared brief

You are one of three designers producing a complete visual direction for Commish, which has pivoted from running leagues to a fantasy football draft prep site: our own projections with a held-out accuracy record, a board per scoring format ranked by points over replacement with tiers, a page per player with prose written from the numbers, a draft advisor with survival odds, mock drafts against bots, a cheat sheet with notes and tags. Launch 2027. Everything free except a Draft Pass and a Membership.

## The founder's brief, verbatim

"Let's also do artifact mocks for the branding and styling for the site before we continue - both light and dark mode. I really like the look of flock fantasy."

## What Flock looks like, from screenshots taken today (in this folder: home-dark.png, rankings-dark.png, player-dark.png, subscribe-dark.png, and the -light variants)

A near-black app shell (#060505) with a 110px icon rail on the left (My Teams, Posts, Rankings, Calculate, Research, Start/Sit, Waivers, Advice, Draft), a persistent search bar across the top, one hot orange accent (#F98919 family) for the brand, CTAs and the active rail item. Poppins for everything, with Exo 2 on display numbers. Tier bands as full-width colored strips with a letter badge (S in red, A in orange, B in yellow) and the band name. Dense rows: rank, headshot, name, a position pill with the positional rank (RB 1 in blue, WR 1 in pink), and cells tinted by magnitude (green for a good number, amber for a middling one) with a big number in each. Sortable column headers. A right rail of filters with the sources as a grid of creator avatars. Chips for the format (Week 5, 2026, 2026 SF, Dyn SF, Dyn 1QB) and the positions. A sign-up form on black with a bright green primary button and white Google and black Apple buttons. Their light mode is the same layout on cream (#F5E8D6) with the same orange. Their mascot is a cartoon goose; we have no mascot and will not invent one.

What the founder likes, inferred: it reads as a product rather than a document; the rail and the chips make every tool one tap away; headshots on every row; magnitude in color; one warm accent on black; a tier band that tells you where the cliffs are.

## What is ours and does not move

- The principles in /Users/jh/code/fantasy/docs/design/2026-09-10-first-principles.md: the person before the number, one big number that says what it is, one action per moment, dense where it decides and roomy where it feels, honest to the decimal, say it the way a friend would. Read them. They are the test every screen passes.
- Copy rules: no em-dashes, no semicolons, no competitor names anywhere on a screen, no tips or explainer text, no trading words (market, price, buy, sell, fade, stock). Every number names its basis in the same view. Use ADP words: "drafters take him 2 picks later".
- Real data only, in this folder: data/board-ppr.csv (400 real 2026 PPR board rows with headshot URLs, projected points, points over replacement, expected games, floor, median, ceiling, tier) and data/capsules.csv (120 real written player capsules, body_compact and body_full). Never invent a number or a sentence. Use the headshot URLs directly (they are public ESPN images).
- Both themes, designed as equals: light is not a dimmed dark. Tokens on :root, redefined under prefers-color-scheme: dark guarded by :root:not([data-theme="light"]) and again under :root[data-theme="dark"]. Contrast 4.5:1 on text.
- Fonts from Google Fonts only. Poppins is allowed if your direction wants it, but do not simply copy Flock's pairing; pick the pair that serves your direction and say why.
- No mascot, no goose, no cartoon.

## Deliverable

A folder named after your direction containing: tokens.css (the complete token set, both themes, with a short comment on each family), board.html (the board: format chips, position chips, the tier bands, 40 real rows with headshots, the right rail or whatever your direction uses for filters and the sheet, and the one solid verb), player.html (one player's page from the capsule data: the hero with the face, the one big number with its basis, the prose, floor and median and ceiling, where drafters take him, and the verb), draft.html (the mock draft room mid-draft: the wall or board of picks, the pool, the advisor's call with survival odds, the clock, your pick coming up; use the board data for picks and the pool), and a one-page direction.html that states the direction in three sentences, shows the palette and the type pair, and links the three screens. Each screen renders in both themes from the same file. Screenshot each screen in both themes at 1440 and at 390 into screenshots/ using the Playwright installed at ../flock (node ../flock/node_modules/playwright or a script there). Then write a short persona walk (veteran, casual, commissioner, first-timer) on the board and the draft room, three lines each, into direction.html.

Keep every file self-contained (inline CSS, no build step), under 16 MB total with the images linked not inlined. Report the folder path, the three-sentence direction, the palette and type pair, and anything in the brief you deliberately departed from and why.
