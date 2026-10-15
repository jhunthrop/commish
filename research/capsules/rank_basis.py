"""A RANK WITH ITS BASIS: a usage rank the sheet states "among" someone is never cut to "of N".

The sheet ranks this season's figures among named peers ("RB31 among 36 running backs with 25 or
more tracked carries"). Cut to "RB31 of 36", the rank loses who it is among and reads beside his board
rank as if it were one (the Lane 23 trial: "a guy we had at RB5 ... RB31 of 36"). So his position code
and a number that is not his page rank, followed by "of" and a count, is a violation that asks for the
basis back. His page rank written that way is left to the board-rank rule (`board_ranks`).
"""

import re

_RANK_OF: str = r"\b{position}(\d{{1,3}})\s+of\s+(?:the\s+)?(\d{{1,4}})\b"


def ranks_without_basis(text: str, position: str, position_rank: int | None) -> list[str]:
    """Every "<position code><rank> of <count>" in `text` whose rank is not his page rank."""
    pattern = re.compile(_RANK_OF.format(position=re.escape(position)))
    return [
        match.group(0)
        for match in pattern.finditer(text)
        if position_rank is None or int(match.group(1)) != position_rank
    ]


def rank_basis_violation(claim: str) -> str:
    return (
        f'The text states a rank, "{claim}", without who it ranks among. Name who it ranks among as the sheet '
        'gives it (for example "among 36 running backs with 25 or more tracked carries"), or leave the rank out.'
    )
