import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// The Matchup's port held to the web's Matchup at 390 (shared/fixtures/parity/matchup.json): the
/// title, the score bug (each side's figures, the game's head and words, the read beside a live score,
/// the standing), the notes, each team's box (every row's cells, the Team row, the bench, the sentence
/// for starters a platform does not send) and the phone's basis at all six fixture clocks; the same
/// reads without the box answer; and the gap sentences with no matchup.
struct MatchupParityTests {
    static let parity: MatchupParity = {
        do {
            return try JSONDecoder().decode(MatchupParity.self, from: Fixtures.data("fixtures/parity/matchup.json"))
        } catch {
            preconditionFailure("shared/fixtures/parity/matchup.json does not read: \(error)")
        }
    }()

    static func week(_ clock: String, box withBox: Bool) throws -> MatchupWeek {
        let model = try MatchupModel(
            sync: Fixtures.matchupSync(clock), box: withBox ? Fixtures.matchupBox(clock) : nil,
            clock: Fixtures.instant(clock), zone: Fixtures.zone
        )
        guard case let .week(week) = model else {
            throw MatchupParity.Missing.week(clock)
        }
        return week
    }

    static func cases() -> [(String, Bool)] {
        StartParityTests.clocks.flatMap { [($0, true), ($0, false)] }
    }

    static func web(_ clock: String, box: Bool) throws -> MatchupParity.Week {
        try #require((box ? parity.clocks : parity.withoutBox)[clock])
    }

    @Test(arguments: cases())
    func theTitleAndTheBugAreTheWebs(clock: String, box: Bool) throws {
        let web = try Self.web(clock, box: box)
        let week = try Self.week(clock, box: box)
        #expect(week.week == web.week)
        #expect(week.mine == web.title.mine)
        #expect(week.opponent == web.title.opponent)
        #expect(week.bug.week == web.bug.week)
        #expect(MatchupParity.Side(week.bug.mine) == web.bug.mine)
        #expect(week.bug.opponent.map(MatchupParity.Side.init) == web.bug.opponent)
        #expect(week.bug.head == web.bug.kickoff?.head)
        #expect(week.bug.words == web.bug.kickoff?.words ?? "")
        #expect(week.bug.started == web.bug.started)
        #expect(week.bug.read == web.bug.read)
        #expect(week.bug.standing == web.bug.standing)
    }

    @Test(arguments: cases())
    func theNotesAreTheWebs(clock: String, box: Bool) throws {
        let web = try Self.web(clock, box: box)
        let week = try Self.week(clock, box: box)
        #expect(week.notes == [web.allPlay, web.scoreGap].compactMap(\.self))
        #expect(week.noOpponent == web.noOpponent)
    }

    @Test(arguments: cases())
    func everyBoxIsTheWebs(clock: String, box: Bool) throws {
        let web = try Self.web(clock, box: box)
        let week = try Self.week(clock, box: box)
        #expect(week.boxes.count == web.boxes.count)
        for (ours, theirs) in zip(week.boxes, web.boxes) {
            #expect(ours.team == theirs.team)
            #expect(ours.mine == theirs.mine)
            #expect(ours.empty == theirs.empty)
            #expect(ours.starters.map(LineupParity.Row.init) == theirs.starters, "\(clock) \(ours.team)")
            #expect(ours.teamRow == TeamRow(
                note: theirs.teamRow.note, live: theirs.teamRow.live, caption: theirs.teamRow.caption,
                proj: theirs.teamRow.proj, pts: theirs.teamRow.pts
            ))
            #expect(ours.bench.map(LineupParity.Row.init) == theirs.bench, "\(clock) \(ours.team) bench")
        }
    }

    @Test(arguments: cases())
    func theBasisIsTheWebsPhoneParagraph(clock: String, box: Bool) throws {
        #expect(try Self.week(clock, box: box).basis == Self.web(clock, box: box).basis)
    }

    @Test func aWeekWeHoldNoGameForSaysTheReadWeCouldNotMake() throws {
        var sync = try Fixtures.matchupSync(StartParityTests.clocks[0])
        sync.matchup = nil
        let unread = MatchupModel(
            sync: sync,
            box: nil,
            clock: Fixtures.instant(StartParityTests.clocks[0]),
            zone: Fixtures.zone
        )
        #expect(unread == .gap(Self.parity.gaps.unread.gap))
        sync.week = 0
        let none = MatchupModel(
            sync: sync,
            box: nil,
            clock: Fixtures.instant(StartParityTests.clocks[0]),
            zone: Fixtures.zone
        )
        #expect(none == .gap(Self.parity.gaps.noWeek.gap))
    }

    /// Every branch of the gap sentences (model.ts readLine and agoWords): fresh, signed out, not
    /// answering and reading again, each just now, in minutes and in hours, on FFPC and on Sleeper.
    @Test func everyReadLineIsTheWebs() throws {
        let base = try Fixtures.matchupSync(StartParityTests.clocks[0])
        #expect(Self.parity.gaps.reads.count == 24)
        for read in Self.parity.gaps.reads {
            var sync = base
            sync.host = .init(value1: .init(rawValue: read.host))
            sync.hostSignedOut = read.state == "signedOut"
            sync.hostFailed = read.state == "failed"
            sync.hostStaleSeconds = read.state == "stale" ? 120 : 0
            let now = base.readAt.addingTimeInterval(read.seconds)
            #expect(MatchupWords.gap(sync, now: now) == read.gap, "\(read.host) \(read.state) \(read.age)")
            #expect(MatchupWords.scoreGap(sync, now: now) == read.scoreGap, "\(read.host) \(read.state) \(read.age)")
        }
    }

    /// No screen computes game state: every starter's line the fixture holds carries the API's field.
    @Test(arguments: StartParityTests.clocks)
    func everyStartersLineCarriesTheAPIsGameState(clock: String) throws {
        let box = try Fixtures.matchupBox(clock)
        let lines = box.sides.flatMap { $0.starters.map(\.line) + $0.bench }
        let stated: Bool = lines.allSatisfy { $0.gameState?.value1.state.value1 != nil }
        #expect(stated)
    }
}

/// shared/fixtures/parity/matchup.json, as the web's readers wrote it.
struct MatchupParity: Decodable {
    enum Missing: Error {
        case week(String)
    }

    struct Side: Decodable, Equatable {
        let label: String
        let name: String
        let big: String
        let bigLabel: String
        let small: String
        let toPlay: String

        init(_ team: BugTeam) {
            label = team.label
            name = team.name
            big = team.big
            bigLabel = team.bigLabel
            small = team.small
            toPlay = team.toPlay
        }
    }

    struct Kickoff: Decodable, Equatable {
        let head: String
        let words: String
    }

    struct Bug: Decodable {
        let week: String
        let mine: Side
        let opponent: Side?
        let kickoff: Kickoff?
        let started: Bool
        let read: String?
        let standing: String?
    }

    struct Title: Decodable {
        let mine: String
        let opponent: String?
    }

    struct TeamRowCells: Decodable {
        let note: String?
        let live: Bool
        let caption: String?
        let proj: String
        let pts: String
    }

    struct Box: Decodable {
        let team: String
        let mine: Bool
        let empty: String?
        let starters: [LineupParity.Row]
        let teamRow: TeamRowCells
        let bench: [LineupParity.Row]

        enum CodingKeys: String, CodingKey {
            case team, mine, empty, starters, bench
            case teamRow = "team_row"
        }
    }

    struct Week: Decodable {
        let week: String
        let title: Title
        let bug: Bug
        let allPlay: String?
        let scoreGap: String?
        let noOpponent: String?
        let boxes: [Box]
        let basis: String
    }

    struct Gap: Decodable {
        let gap: String
    }

    struct Read: Decodable {
        let host: String
        let state: String
        let age: String
        let seconds: Double
        let gap: String
        let scoreGap: String
    }

    struct Gaps: Decodable {
        let unread: Gap
        let noWeek: Gap
        let reads: [Read]
    }

    let clocks: [String: Week]
    let withoutBox: [String: Week]
    let gaps: Gaps
}
