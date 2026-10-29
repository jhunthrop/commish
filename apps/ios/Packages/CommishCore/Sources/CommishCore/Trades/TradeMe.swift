import CommishAPI
import CommishDesign
import Foundation

/// The member's side as the builder names it: the team and where it stands.
public struct TradeMe: Equatable, Sendable {
    public let name: String
    public let aside: String

    public init(name: String, aside: String) {
        self.name = name
        self.aside = aside
    }

    /// The followed league's team and standing (TradeScreen's me: the switch's team name and
    /// model.ts standingWords, "5-1, 2nd of 12"); "You" for a league saved before the app kept its team
    /// (review L3).
    public init(league: FollowedLeague) {
        let team = league.teamName ?? ""
        name = team.isEmpty ? Words.Box.you : team
        aside = league.standing.map { standing in
            let record = "\(standing.wins)-\(standing.losses)"
            let words = standing.ties > 0 ? "\(record)-\(standing.ties)" : record
            return "\(words), \(Formatting.ordinal(standing.place)) of \(standing.teams)"
        } ?? ""
    }
}
