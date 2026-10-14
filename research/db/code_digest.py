"""THE CODE A CACHED READ RUNS, AS A DIGEST: the read cache's code version (`db.read_cache`).

Keying a kept result on the deploy's commit would throw every result away on each deploy, though
most deploys touch nothing a cached read runs, and a night that misses moves the whole history
again (about 200 MB of the facts pass on the dev store). So the version is a digest of:

- the source of every research module the cached read can reach: the modules named and, from the
  source itself (the `import` and `from ... import` statements anywhere in each file, nested ones
  included), every research module they import, each package's `__init__` on the way, and every
  submodule a `from` names. Reading the imports rather than the loaded values catches a module
  reached only for a plain constant, which carries no `__module__` (review MEDIUM-1);
- the name and version of every installed distribution, since the arithmetic and the drivers
  (numpy, pandas, psycopg, SQLAlchemy) can change a result as surely as our own code.

A change to any of them is a new version; a change anywhere else is not.
"""

import ast
import hashlib
import importlib.metadata
import importlib.util
from collections.abc import Iterable, Iterator
from functools import cache
from pathlib import Path
from typing import Final

_PACKAGE: Final = "research"


def _is_research(name: str) -> bool:
    return name == _PACKAGE or name.startswith(f"{_PACKAGE}.")


def _source(name: str) -> Path | None:
    """The module's file, or None for a name that is not a research module (an imported value)."""
    try:
        spec = importlib.util.find_spec(name)
    except (ImportError, ValueError):
        return None
    origin = None if spec is None else spec.origin
    return Path(origin) if origin is not None and origin.endswith(".py") else None


def _with_parents(name: str) -> Iterator[str]:
    parts = name.split(".")
    for end in range(1, len(parts) + 1):
        yield ".".join(parts[:end])


def _imported(source: str) -> Iterator[str]:
    """Every research module name an import statement in `source` names, or may name."""
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            yield from (alias.name for alias in node.names if _is_research(alias.name))
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module and _is_research(node.module):
            yield node.module
            yield from (f"{node.module}.{alias.name}" for alias in node.names)


def import_closure(roots: Iterable[str]) -> dict[str, Path]:
    """Every research module reachable from `roots` through import statements, to its file."""
    seen: dict[str, Path] = {}
    stack = [parent for root in roots for parent in _with_parents(root)]
    while stack:
        name = stack.pop()
        if name in seen:
            continue
        path = _source(name)
        if path is None:
            continue
        seen[name] = path
        for imported in _imported(path.read_text()):
            stack.extend(parent for parent in _with_parents(imported) if parent not in seen)
    return dict(sorted(seen.items()))


def _distributions() -> list[str]:
    return sorted({f"{d.metadata['Name']}=={d.version}" for d in importlib.metadata.distributions()})


@cache
def code_digest(*module_names: str) -> str:
    """The digest of the reachable research source and the installed distributions."""
    digest = hashlib.sha256()
    for name, path in import_closure(module_names).items():
        digest.update(name.encode())
        digest.update(path.read_bytes())
    digest.update("\n".join(_distributions()).encode())
    return f"code-sha256:{digest.hexdigest()[:16]}"
