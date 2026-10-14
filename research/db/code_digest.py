"""THE CODE A CACHED READ RUNS, AS A DIGEST: the read cache's code version (`db.read_cache`).

Keying a kept result on the deploy's commit would throw every result away on each deploy, though
most deploys touch nothing a cached read runs, and a night that misses moves the whole history
again (about 200 MB of the facts pass on the dev store). So the version is a digest of the source
of every research module the cached read can reach: the modules named, and every research module
reached from them through what they import (a module, or a function, class or value whose module
is a research module), each module's file read whole. A change to any of them is a new version; a
change anywhere else is not.
"""

import hashlib
import sys
from collections.abc import Iterable
from functools import cache
from pathlib import Path
from types import ModuleType
from typing import Final

_PACKAGE: Final = "research"


def _research(name: str | None) -> ModuleType | None:
    if name is None or not (name == _PACKAGE or name.startswith(f"{_PACKAGE}.")):
        return None
    return sys.modules.get(name)


def _reached(module: ModuleType) -> Iterable[ModuleType]:
    for value in vars(module).values():
        target = value if isinstance(value, ModuleType) else _research(getattr(value, "__module__", None))
        if isinstance(target, ModuleType) and _research(target.__name__) is not None:
            yield target


def import_closure(roots: Iterable[ModuleType]) -> list[ModuleType]:
    """Every research module reachable from `roots`, by name."""
    seen: dict[str, ModuleType] = {}
    stack = list(roots)
    while stack:
        module = stack.pop()
        if module.__name__ in seen:
            continue
        seen[module.__name__] = module
        stack.extend(_reached(module))
    return [seen[name] for name in sorted(seen)]


@cache
def code_digest(*module_names: str) -> str:
    """The digest of the source of every research module reachable from the named ones."""
    digest = hashlib.sha256()
    for module in import_closure(sys.modules[name] for name in module_names):
        origin = getattr(module.__spec__, "origin", None)
        if origin is None or not origin.endswith(".py"):
            raise RuntimeError(f"{module.__name__} has no source file to digest")
        digest.update(module.__name__.encode())
        digest.update(Path(origin).read_bytes())
    return f"code-sha256:{digest.hexdigest()[:16]}"
