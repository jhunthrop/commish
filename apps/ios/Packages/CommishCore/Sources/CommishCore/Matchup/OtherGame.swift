import CommishAPI
import CommishDesign
import Foundation

/// Any game of the week on the Matchup (web/src/lib/league/box/game.ts, Lane 204): the member's score
/// bug opens the member's game, every other bug the game of its first side's roster. Whose game a box
/// is comes from the box's own word (MatchupBox.viewer_side), never from the scoreboard; the score and
/// the teams of another team's game are the scoreboard's.
public enum OtherGame {
    /// game.ts isOtherGame: an answer from before Lane 204 sends no viewer_side and is always the
    /// member's game.
    public static func isOther(_ box: MatchupBox?) -> Bool {
        box?.viewerSide?.value1 == .other
    }

    /// game.ts otherGame: another team's game as the Matchup draws its head and score, its sides in the
    /// box's order, each with the box's flags and the scoreboard's points (unread where the scoreboard
    /// was not read or lists no such side), no starters of the platform's own read, as the box holds
    /// every row. Nil where the box is the member's game or has no side.
    static func matchup(_ box: MatchupBox?, board: Scoreboard?) -> Components.Schemas.LeagueMatchup? {
        guard let box, isOther(box) else {
            return nil
        }
        let scored = Dictionary(
            (board?.games ?? []).flatMap(\.sides).map { ($0.rosterId, $0) }, uniquingKeysWith: { first, _ in first }
        )
        let sides = box.sides.map { side in
            Components.Schemas.MatchupSide(
                rosterId: side.rosterId, points: scored[side.rosterId]?.points ?? 0,
                playerPoints: side.playerPoints, teamTotal: side.teamTotal,
                pointsRead: scored[side.rosterId]?.pointsRead ?? false, starters: []
            )
        }
        guard let mine = sides.first else {
            return nil
        }
        return .init(week: box.week, mine: mine, opponent: sides.dropFirst().first.map { .init(value1: $0) })
    }
}

/// The head of another team's game (MatchupPanel.svelte's whose line): "Their game", and the way back
/// to the member's own.
public struct GameWhose: Equatable, Sendable {
    public let head: String
    public let link: String

    static let theirs = GameWhose(head: Words.Matchup.theirGame, link: Words.Matchup.yourGame)
}
