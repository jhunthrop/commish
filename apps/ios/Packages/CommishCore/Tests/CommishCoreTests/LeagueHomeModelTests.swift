@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// The League home's model reads the fixture league exactly as the web's readers do: every score
/// bug, standings row, move and basis sentence equals the web's output on the same answers at the
/// same clock (shared/fixtures/parity/league-home.json).
struct LeagueHomeModelTests {
    private static let clocks = [
        "2026-10-16T02-00-00Z", "2026-10-17T17-00-00Z", "2026-10-18T18-56-00Z",
        "2026-10-19T16-00-00Z", "2026-10-20T00-40-00Z", "2026-10-20T17-00-00Z",
    ]

    private func model(at clock: String) throws -> LeagueHomeModel {
        try LeagueHomeModel(
            sync: Fixtures.sync(),
            scoreboard: Fixtures.scoreboard(clock),
            now: Fixtures.instant(clock),
            zone: Fixtures.zone
        )
    }

    @Test(arguments: clocks)
    func scoreBugsMatchTheWeb(clock: String) throws {
        let web = try #require(Fixtures.parity().clocks[clock])
        let bugs = try model(at: clock).bugs.map { bug in
            Parity.Bug(
                mine: bug.mine, state: bug.state.rawValue, head: bug.head, words: bug.words,
                small: bug.small, big: bug.big,
                sides: bug.sides.map {
                    Parity.Side(
                        name: $0.name, record: $0.record, me: $0.me, small: $0.small, big: $0.big,
                        toPlay: $0.toPlay, stands: $0.stands.rawValue
                    )
                }
            )
        }
        #expect(bugs == web.bugs)
    }

    @Test(arguments: clocks)
    func standingsMatchTheWeb(clock: String) throws {
        let web = try #require(Fixtures.parity().clocks[clock])
        let rows = try model(at: clock).standings.rows.map {
            Parity.Standing(
                rank: $0.rank, team: $0.team, record: $0.record, pointsFor: $0.pointsFor,
                pointsAgainst: $0.pointsAgainst, streak: $0.streak, waiver: $0.waiver, proj: $0.proj, me: $0.me
            )
        }
        #expect(rows == web.standings)
    }

    @Test(arguments: clocks)
    func theTeamBasisMatchesTheWeb(clock: String) throws {
        let web = try #require(Fixtures.parity().clocks[clock])
        #expect(try model(at: clock).teamBasis == web.teamBasis)
    }

    @Test(arguments: clocks)
    func theBasisParagraphIsThePhonesOnTheWeb(clock: String) throws {
        let web = try #require(Fixtures.parity().clocks[clock])
        #expect(try model(at: clock).basis == web.phoneBasis)
    }

    @Test func movesMatchTheWebNewestFirst() throws {
        let web = try Fixtures.parity()
        let moves = try model(at: Fixtures.week).moves.rows.map { row in
            Parity.Move(
                when: row.when, kind: row.kind, teams: row.teams,
                adds: row.adds.map { Parity.Player(name: $0.name, position: $0.position, club: $0.club, to: $0.to) },
                drops: row.drops.map { Parity.Player(name: $0.name, position: $0.position, club: $0.club, to: nil) },
                detail: row.detail, mine: row.mine
            )
        }
        #expect(moves == web.moves)
    }

    @Test func theStandingsWordsMatchTheWeb() throws {
        let web = try Fixtures.parity()
        let standings = try model(at: Fixtures.week).standings
        #expect(standings.basis == web.standingsBasis)
        #expect(standings.seeding == web.seeding)
        #expect(standings.playoffCut == web.playoffRule?.after)
    }

    @Test func theScreenSaysTheWebsWords() throws {
        let home = try model(at: Fixtures.sunday)
        #expect(home.weekTitle == "\(Words.LeagueHome.week) 6")
        #expect(home.scoreboardAside == Words.LeagueHome.scoreboardAside)
        #expect(home.standings.title == Words.LeagueHome.standings)
        #expect(home.standings.columns == [
            Words.LeagueHome.rank, Words.LeagueHome.team, Words.LeagueHome.record,
            Words.LeagueHome.pointsFor, Words.Box.proj,
        ])
        #expect(home.moves.title == Words.LeagueHome.moves)
        #expect(home.moves.aside == Words.LeagueHome.movesAside)
        #expect(home.platform == "FFPC")
    }

    @Test func theMembersRowIsMarkedAndTheirGameLeads() throws {
        let home = try model(at: Fixtures.sunday)
        #expect(home.standings.rows.filter(\.me).map(\.team) == ["McConkey Kong Country"])
        #expect(home.bugs.first?.mine == true)
    }

    @Test func noMovesSaysTheWebsSentence() throws {
        var sync = try Fixtures.sync()
        sync.moves = []
        let home = try LeagueHomeModel(
            sync: sync, scoreboard: Fixtures.scoreboard(Fixtures.week),
            now: Fixtures.instant(Fixtures.week), zone: Fixtures.zone
        )
        #expect(home.moves.rows.isEmpty)
        #expect(home.moves.note == Words.LeagueHome.noMoves)
    }

    @Test func unreadMovesNameThePlatform() throws {
        var sync = try Fixtures.sync()
        sync.moves = []
        sync.movesRead = false
        let home = try LeagueHomeModel(
            sync: sync, scoreboard: nil, now: Fixtures.instant(Fixtures.week), zone: Fixtures.zone
        )
        #expect(home.moves.note == "FFPC gives no move history to us.")
        #expect(home.bugs.isEmpty)
        #expect(home.standings.columns.contains(Words.Box.proj) == false)
    }

    @Test func theLineupListsTheMembersStartersAndTheBench() throws {
        let home = try model(at: Fixtures.sunday)
        let lineup = try #require(home.lineup)
        #expect(lineup.title == Words.LeagueHome.yourLineup)
        #expect(lineup.setOn == "As set on FFPC")
        #expect(lineup.rows.count == 10)
        #expect(lineup.rows.first?.name == "Aaron Rodgers")
        #expect(lineup.verb == Words.LeagueHome.openLineup)
        #expect(lineup.bench == "Bench, 10 players")
    }
}
