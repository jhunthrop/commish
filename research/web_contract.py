"""WHERE THE WEB'S CONTRACT IS: the web files the research lane reads, in one place.

The nightly's schema gate drives the web's own reader (`nightly/schema_gate.py`), and the writer reads
the site's one banned list (`capsules/site_words.py`). In the research image the web-contract stage
copies them into `WEB_CONTRACT_DIR` (research/Dockerfile: `src/lib/run`, `src/lib/format` and the
reader); in a developer's tree they are the repository's own web/.
"""

import os
from pathlib import Path
from typing import Final

CONTRACT_DIR_VARIABLE: Final = "WEB_CONTRACT_DIR"
# The repository's web/ in a developer's tree (the schema gate needs `npm ci` there for node_modules).
_REPOSITORY_WEB: Final = Path(__file__).resolve().parents[1] / "web"


def contract_dir(environ: dict[str, str] | os._Environ[str]) -> Path:
    configured = environ.get(CONTRACT_DIR_VARIABLE, "").strip()
    return Path(configured) if configured else _REPOSITORY_WEB


def figure_words_path(environ: dict[str, str] | os._Environ[str]) -> Path:
    """The site's one words table (api/internal/figurewords/words.json), beside the web's contract as
    the image's web-contract stage lays it out and as the repository holds it."""
    return contract_dir(environ).parent / "api" / "internal" / "figurewords" / "words.json"
