"""A LOCAL TCP RELAY THAT COUNTS EVERY BYTE: the wire's own total, beside the meter's per-statement sum.

The job's engine connects to the relay, which forwards to a local Postgres and counts what flows
each way: from the server (what a hosted store bills as transfer out) and to it. It relays only to
a loopback host; a measurement never touches a remote store.
"""

import contextlib
import socket
import threading
from dataclasses import dataclass
from typing import Final

from research.transfer.target import is_loopback

_CHUNK: Final = 65_536


@dataclass(frozen=True, slots=True)
class WireTotals:
    from_server: int
    to_server: int
    connections: int


class CountingRelay:
    """Listens on an ephemeral loopback port and relays each connection to (host, port)."""

    def __init__(self, host: str, port: int) -> None:
        if not is_loopback(host):
            raise ValueError(f"the relay forwards only to a loopback host, not {host!r}")
        self._target = (host, port)
        self._lock = threading.Lock()
        self._from_server = 0
        self._to_server = 0
        self._connections = 0
        self._listener = socket.create_server(("127.0.0.1", 0))
        self.port: int = self._listener.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def totals(self) -> WireTotals:
        with self._lock:
            return WireTotals(self._from_server, self._to_server, self._connections)

    def _accept(self) -> None:
        while True:
            try:
                client, _ = self._listener.accept()
            except OSError:
                return
            server = socket.create_connection(self._target)
            with self._lock:
                self._connections += 1
            threading.Thread(target=self._pump, args=(server, client, True), daemon=True).start()
            threading.Thread(target=self._pump, args=(client, server, False), daemon=True).start()

    def _pump(self, source: socket.socket, sink: socket.socket, from_server: bool) -> None:
        try:
            while chunk := source.recv(_CHUNK):
                sink.sendall(chunk)
                with self._lock:
                    if from_server:
                        self._from_server += len(chunk)
                    else:
                        self._to_server += len(chunk)
        except OSError:
            pass
        finally:
            for end in (source, sink):
                with contextlib.suppress(OSError):
                    end.shutdown(socket.SHUT_RDWR)

    def close(self) -> None:
        self._listener.close()
