import CommishAPI
import CommishDesign
import Foundation

/// One team's standings row as a phone draws it (web Standings.svelte): rank, team with its streak
/// under the name, W-L-T, PF and the week's Proj; PA and the waiver column ride along for the desk.
public struct StandingsLine: Sendable, Equatable, Identifiable {
    public var id: Int {
        rosterID
    }

    public let rosterID: Int
    public let rank: Int
    public let team: String
    public let record: String
    public let pointsFor: String
    public let pointsAgainst: String
    public let streak: String
    public let waiver: String
    public let proj: String
    public let me: Bool
}

public struct StandingsSection: Sendable, Equatable {
    public let title: String
    /// The phone's column heads, the Proj only once the week has a scoreboard.
    public let columns: [String]
    public let rows: [StandingsLine]
    /// The rank the playoff rule is drawn under, where the platform seeds on record alone.
    public let playoffCut: Int?
    /// What the rule says ("Top 6 by record, playoffs weeks 15 to 17"), nil with no rule.
    public let playoffWords: String?
    /// How the platform seeds its playoffs where it seeds on points too (FFPC), nil otherwise.
    public let seeding: String?
    /// What the numbers are, said once.
    public let basis: String
}

/// home.ts standingsRows, recordCell, waiverCell, playoffRule, seedingWords.
enum Standings {
    typealias Home = CommishDesign.Words.LeagueHome

    static func section(_ sync: LeagueSync, projections: [Int: Double?], projected: Bool) -> StandingsSection {
        let rows = sync.teams.enumerated().map { index, team in
            StandingsLine(
                rosterID: team.rosterId,
                rank: index + 1,
                team: team.name,
                record: "\(team.wins)-\(team.losses)-\(team.ties)",
                pointsFor: Formatting.fixed(team.pointsFor),
                pointsAgainst: figure(team.pointsAgainst),
                streak: team.streak ?? "",
                waiver: waiverCell(team, terms: sync.terms),
                proj: figure(projections[team.rosterId].flatMap(\.self)),
                me: team.rosterId == sync.me
            )
        }
        let rule = playoffRule(sync.terms, teams: sync.teams.count)
        return StandingsSection(
            title: Home.standings,
            columns: [Home.rank, Home.team, Home.record, Home.pointsFor] + (projected ? [PortedWords.Box.proj] : []),
            rows: rows,
            playoffCut: rule?.after,
            playoffWords: rule?.words,
            seeding: seeding(sync.terms, host: sync.host),
            basis: WeekBasis.standings(host: sync.host, terms: sync.terms)
        )
    }

    private static func figure(_ value: Double?) -> String {
        value.map { Formatting.fixed($0) } ?? PortedWords.Box.none
    }

    /// "$675" left of the budget, "6th" in the order, "--" where unsaid.
    static func waiverCell(_ team: Components.Schemas.LeagueTeam, terms: Components.Schemas.LeagueTerms) -> String {
        if terms.waivers == .budget, let left = team.waiverBudgetLeft {
            return Formatting.dollars(left)
        }
        if terms.waivers == .order, let order = team.waiverOrder {
            return Formatting.ordinal(order)
        }
        return PortedWords.Box.none
    }

    static func playoffRule(_ terms: Components.Schemas.LeagueTerms, teams: Int) -> (after: Int, words: String)? {
        guard let count = terms.playoffTeams, count > 0, count < teams else {
            return nil
        }
        let top = "Top \(count) by record"
        let weeks = weeksWords(terms.playoffWeeks?.value1)
        return (count, weeks.isEmpty ? "\(top) make the playoffs" : "\(top), playoffs\(weeks.dropFirst())")
    }

    static func seeding(_ terms: Components.Schemas.LeagueTerms, host: Components.Schemas.LeagueHost) -> String? {
        let seeds = terms.playoffSeeds ?? []
        guard seeds.contains(.points) else {
            return nil
        }
        let seededBy: [String] = [(.record, "on record"), (.points, "on points")].compactMap { kind, words in
            let numbers = seeds.enumerated().filter { $0.element == kind }.map { $0.offset + 1 }
            return numbers.isEmpty ? nil : "\(seedNumbers(numbers)) \(words)"
        }
        let platform = PortedWords.platform(host)
        return "\(platform) seeds \(seeds.count) for the playoffs\(weeksWords(terms.playoffWeeks?.value1)): "
            + "\(seededBy.joined(separator: ", "))."
    }

    /// "1", "1 and 3", "1, 3 and 5".
    private static func seedNumbers(_ seeds: [Int]) -> String {
        let words = seeds.map(String.init)
        guard let last = words.last else {
            return ""
        }
        return words.count == 1 ? last : "\(words.dropLast().joined(separator: ", ")) and \(last)"
    }

    /// ", weeks 15 to 17", ", week 16", or nothing unsaid.
    private static func weeksWords(_ weeks: Components.Schemas.PlayoffWeeks?) -> String {
        guard let weeks else {
            return ""
        }
        return weeks.first == weeks.last ? ", week \(weeks.first)" : ", weeks \(weeks.first) to \(weeks.last)"
    }
}
