"""THE WEEK-AHEAD READ (Lane 72): the grounded writer's second read per player, about the week in front of him.

The season read (`capsules.generate`) speaks to his season; this one speaks to his next game, in three to
five sentences, from the facts the in-season store holds for that week, each stamped at or before the
write: the week's published projection and its change since the last read, the opponent and its rank
against his position, his club's expected points and the weather, his status and his place on the depth
chart, his last three games, and his place in our order. The parts:

- `sheet`: the week's facts for one player, stamped, and the sheet the writer reads.
- `collect`: the facts read from the store at an instant, for every board player.
- `rules`: the week read's own rules on top of the writer's (`validate`): the published projection never
  named in the read and never called ours (Lane 275); a player who cannot play never recommended; a bye named; no betting word,
  no provider or rival product, no tip; three to five sentences.
- `prompt`, `write`: the writer's instructions, and one read written within its ceiling of calls, the
  facts block its counted fallback.
- `cadence`: when a read is written again (no read for the week, his status changed, the last one
  fell to its facts block); a projection move leaves the read standing (Lane 275).
- `store`, `shared`: the table (revision 0012), and the demotion of a sentence on two pages.
- `caption`: the page's "Written Fri 9:00 pm Central, for week 6".
"""
