import CommishAPI
import CommishDesign
import Foundation

/// The lobby's words that carry a figure or a name (web/src/lib/room/lobby-words.ts, setup/setup.ts
/// and format/draft.ts clockLabel), ported and held to shared/fixtures/parity/lobby.json; the plain
/// words are the generated `Words.Lobby`.
public enum LobbyWords {
    /// draft.ts clockLabel: a clock in whole seconds as minutes and seconds, "0:27", "1:05".
    public static func clock(_ seconds: Int) -> String {
        let left = max(0, seconds)
        let part = left % 60
        return "\(left / 60):\(part < 10 ? "0" : "")\(part)"
    }

    /// lobby-words.ts pickClockWords: "30 s a pick".
    public static func pickClock(_ seconds: Int) -> String {
        "\(seconds) s a pick"
    }

    /// lobby-words.ts byPeopleWords: "2 of the last 12 by people".
    public static func byPeople(_ people: Int, of count: Int) -> String {
        "\(people) of the last \(count) by people"
    }

    /// lobby-words.ts waitWords: the filling room's line after its count.
    public static func wait(teams: Int, secondsLeft: Int) -> String {
        "The draft starts when \(teams) are in, or in \(clock(secondsLeft)) with bots in the open seats."
    }

    /// lobby-words.ts aboutHead: "12 PPR lobby".
    public static func aboutHead(teams: Int, preset: String) -> String {
        "\(teams) \(preset) lobby"
    }

    /// lobby-words.ts aboutWords: who is in the room, then the clock and what happens to a seat that
    /// steps away.
    public static func about(people: Int, teams: Int, started: Bool, clockSeconds: Int) -> String {
        let rest = started
            ? " and \(Formatting.plural(teams - people, "bot"))"
            : ", \(Formatting.plural(teams - people, "seat")) open"
        return "\(Formatting.plural(people, "drafter"))\(rest). \(clockSeconds) seconds a pick, your queue drafts "
            + "if you step away, a bot takes any seat that closes the tab."
    }

    /// lobby-words.ts seatsWords: "3 drafters, 9 bots".
    public static func seats(people: Int, teams: Int) -> String {
        "\(Formatting.plural(people, "drafter")), \(Formatting.plural(teams - people, "bot"))"
    }

    /// lobby-words.ts soloAgainWords: "Run it against bots from slot 5".
    public static func soloAgain(_ slot: Int) -> String {
        "Run it against bots from slot \(slot)"
    }

    /// lobby-words.ts queueFirstWords over call.ts draftWords with Queue: "Queue him first".
    public static func queueFirst(_ position: String) -> String {
        "\(Words.Mock.queue) \(position == "DST" ? "them" : "him") first"
    }

    /// lobby-words.ts roundWords and pickWords: "Round 3", "Pick 3.05".
    public static func round(_ round: Int) -> String {
        "Round \(round)"
    }

    public static func pick(_ pick: Int, teams: Int) -> String {
        "Pick \(DraftFormat.pickLabel(pick, teams: teams))"
    }

    /// lobby-words.ts yourPickIn: "3.05, in 7".
    public static func yourPickIn(_ pick: Int, away: Int, teams: Int) -> String {
        "\(DraftFormat.pickLabel(pick, teams: teams)), in \(away)"
    }

    /// lobby-words.ts secondsLeftWords: "10 seconds left".
    public static func secondsLeft(_ mark: Int) -> String {
        "\(mark) seconds left"
    }

    /// lobby-words.ts seatLabel: a compact seat as a screen reader names it, "Bot 3, open, on the clock".
    public static func seatLabel(_ name: String, open: Bool, onClock: Bool) -> String {
        name + (open ? ", \(Words.Lobby.seatOpen)" : "") + (onClock ? ", \(Words.Lobby.seatOnClock)" : "")
    }

    /// setup.ts lobbyFillWords: the drafters in, never a score against the seats; "No one in yet".
    public static func fill(_ filling: Int) -> (words: String, empty: Bool) {
        filling > 0 ? ("\(filling) in", false) : ("No one in yet", true)
    }

    /// setup.ts lobbyListHead: "Lobbies filling now" from the first seat taken, else "Open lobbies".
    public static func listHead(_ fillings: [Int]) -> String {
        fillings.contains { $0 > 0 } ? "Lobbies filling now" : "Open lobbies"
    }

    /// setup.ts lobbyTitle: "12 teams, PPR", "12 teams, half PPR, superflex".
    public static func title(teams: Int, preset: String, lineup: String) -> String {
        "\(teams) teams, \(RoomWords.preset(preset))\(lineup == "superflex" ? ", superflex" : "")"
    }
}
