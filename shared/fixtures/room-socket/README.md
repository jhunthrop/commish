# The room socket's exchange

`exchange.json` is section 10 of `docs/superpowers/specs/2026-10-24-room-protocol.md` as a script, one
list of steps per socket: what the client sends (`client`), what the room sends (`server`), how the
socket ends (`close`, with its code, reason and the upgrade's status when it was refused before it
opened) and the client leaving the room (`end`, its close with 1000). The first socket reaches its welcome, queues, is refused a
pick and drops mid-draft; the second says hello with the last seq it applied and its welcome carries
exactly the two picks made while it was gone. Written by hand from the protocol and the room service's
frames (`api/internal/rooms/socket.go`); the apps' socket clients replay it in their tests.

`phone_now` is the phone's clock when each welcome is read, so the clock offset is the welcome's
`now` less it.
