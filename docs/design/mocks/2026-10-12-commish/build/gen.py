import board
import direction
import league
import lobby
import mock
import report
import setup
import player
import system
from data import load_board, load_capsules
from shell import OUT


def main():
    players = load_board()
    capsules = load_capsules()
    pages = {
        "board.html": board.build(players),
        "player.html": player.build(players, capsules),
        "league.html": league.build(),
        "setup.html": setup.build(),
        "mock.html": mock.build(players),
        "lobby.html": lobby.build(players),
        "report.html": report.build(players),
        "system.html": system.build(players),
        "direction.html": direction.build(),
    }
    for name, html in pages.items():
        (OUT / name).write_text(html)
        print(name, len(html))


if __name__ == "__main__":
    main()
