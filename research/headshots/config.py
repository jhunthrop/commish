"""The copies' one set of constants: the bucket, its public host, the widths, the cache rule, the
fetch rate, and the address of a copy. The web (`web/src/lib/ui/headshot.ts`) and the API
(`api/internal/headshots`) build the same addresses; each pins one example URL in its tests."""

import re
from typing import Final

from research.errors import ConfigurationError

IMAGES_BUCKET: Final = "commish-images"
# The bucket's public custom domain on the site's zone: the web and the apps read the copies here.
IMAGES_ORIGIN: Final = "https://images.trycommish.app"
# The widths a copy is kept at, each with the source's aspect: every width the web asks for maps to
# the smallest of these at or above it (`web/src/lib/ui/headshot.ts`: faces 22 to 168 px drawn 1.4
# times their circle at 1x and 2x, and the share card's 480), so no face is drawn from an image
# narrower than it is drawn, or more than one step wider.
WIDTHS: Final = (48, 64, 96, 128, 160, 240, 320, 480)
# The width the API and the run answer: the apps' largest face (72 pt at 3x, 216 px tall in an image
# of the provider's 600 x 436 aspect, 297 px wide).
APP_WIDTH: Final = 320
CACHE_CONTROL: Final = "public, max-age=31536000, immutable"
WEBP: Final = "image/webp"
# At most two fetches a second from a source.
FETCH_INTERVAL_SECONDS: Final = 0.5
# The players a sync works on at once: a fetch's wait on the source host, the eight bucket writes and
# the ledger write overlap, while the one throttle still spaces the fetches at the interval above.
SYNC_WORKERS: Final = 4
# The workers a sync may be given; a value outside is refused, never clamped.
SYNC_WORKERS_RANGE: Final = (1, 16)
# The only host a synced source may name (the provider's image host); a curated URL may name any.
SYNC_SOURCE_HOSTS: Final = frozenset({"a.espncdn.com"})
# The provider's placeholder for a player it has no photo of: no image, so the player is missing.
NO_PHOTO_MARK: Final = "/i/headshots/nophoto.png"
# The rows a face is answered for.
FACE_STATUSES: Final = ("copied", "curated")

_PLAYER_ID: Final = re.compile(r"^[0-9]{1,12}$")


def is_player_id(player_id: str) -> bool:
    """Whether `player_id` is a provider player id, a key segment: digits only."""
    return _PLAYER_ID.match(player_id) is not None


def check_player_id(player_id: str) -> None:
    """A provider player id, or a ConfigurationError naming it."""
    if not is_player_id(player_id):
        raise ConfigurationError(f'"{player_id}" is not a provider player id.')


def copy_key(season: int, player_id: str, width: int) -> str:
    """The bucket key of one copy: `headshots/<season>/<player_id>/<width>.webp`."""
    check_player_id(player_id)
    if width not in WIDTHS:
        raise ConfigurationError(f"{width} is not a kept width ({', '.join(map(str, WIDTHS))}).")
    return f"headshots/{season}/{player_id}/{width}.webp"


def face_url(season: int, player_id: str, width: int = APP_WIDTH) -> str:
    """A copy's public address, the `headshot` the API and the run answer."""
    return f"{IMAGES_ORIGIN}/{copy_key(season, player_id, width)}"
