import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// The Start screen's port held to the web's Lineup at 390 (shared/fixtures/parity/lineup.json): the
/// strip, every row's cells, the Team row, the pinned verb and its line, the copied lineup, the
/// move's changes and the phone's basis at all six fixture clocks, the same answers with ESPN's writes
/// open, and the move's words per platform with each outcome.
struct StartParityTests {
    static let clocks = [
        "2026-10-16T02-00-00Z", "2026-10-17T17-00-00Z", "2026-10-18T18-56-00Z",
        "2026-10-19T16-00-00Z", "2026-10-20T00-40-00Z", "2026-10-20T17-00-00Z",
    ]

    static let parity: LineupParity = {
        do {
            return try JSONDecoder().decode(LineupParity.self, from: Fixtures.data("fixtures/parity/lineup.json"))
        } catch {
            preconditionFailure("shared/fixtures/parity/lineup.json does not read: \(error)")
        }
    }()

    static func model(_ clock: String, writes: Bool) throws -> StartModel {
        var advice = try Fixtures.lineup(clock)
        var host = try Fixtures.sync().host
        if writes {
            advice.moves = .init(
                takesWrites: true,
                writesOn: true,
                reason: nil,
                lineup: .init(value1: .available),
                note: nil
            )
            host = .init(value1: .espn)
        }
        return StartModel(advice: advice, host: host, now: Fixtures.instant(clock), zone: Fixtures.zone)
    }

    @Test(arguments: clocks)
    func theStripIsTheWebs(clock: String) throws {
        let web = try #require(Self.parity.clocks[clock])
        let model = try Self.model(clock, writes: false)
        #expect(model.week == "Week \(web.week)")
        #expect(model.title == web.title)
        #expect(model.decision == web.decision)
        #expect(model.sum.map { LineupParity.Sum(figure: $0.figure, words: $0.words, gain: $0.gain, final: $0.final) }
            == web.sum)
        #expect(model.done == web.done)
        #expect(model.missed == web.missed)
        let idle = model.chips.compactMap {
            if case let .idle(words) = $0 {
                words
            } else {
                nil
            }
        }
        let swaps = model.chips.compactMap {
            if case let .swap(swap) = $0 {
                StartWords.swap(swap)
            } else {
                nil
            }
        }
        #expect(idle == (web.chipsShown ? web.idle : []))
        #expect(swaps == (web.chipsShown ? web.swaps.map(\.words) : []))
    }

    @Test(arguments: clocks)
    func everyRowIsTheWebs(clock: String) throws {
        let web = try #require(Self.parity.clocks[clock])
        let model = try Self.model(clock, writes: false)
        #expect(model.starters.map(LineupParity.Row.init) == web.starters)
        #expect(model.bench.map(LineupParity.Row.init) == web.bench)
        #expect(model.reserve.map(LineupParity.Row.init) == web.reserve)
        #expect(model.empty == web.empty)
        #expect(model.team == TeamRow(
            note: web.team.note, live: web.team.live, caption: web.team.caption, proj: web.team.proj, pts: web.team.pts
        ))
    }

    @Test(arguments: clocks)
    func theBasisIsTheWebsPhoneParagraph(clock: String) throws {
        let web = try #require(Self.parity.clocks[clock])
        #expect(try Self.model(clock, writes: false).basis == web.basis)
    }

    @Test(arguments: clocks)
    func theVerbItsLineTheMoveAndTheCopyAreTheWebs(clock: String) throws {
        for writes in [false, true] {
            let web = try #require((writes ? Self.parity.writes : Self.parity.clocks)[clock])
            let model = try Self.model(clock, writes: writes)
            #expect(model.verb?.title == web.pinned.verb, "\(clock) writes \(writes)")
            let lines = (web.pinned.page.map { [$0] } ?? []) + (web.pinned.line.map { $0.isEmpty ? [] : [$0] } ?? [])
            #expect(model.foot.map { $0.map(\.text).joined() } == lines, "\(clock) writes \(writes)")
            #expect(model.move.changes.map { LineupParity.Change(
                slot: $0.slot.value1?.rawValue ?? "",
                player: $0._in,
                out: $0.out
            ) }
                == web.changes)
            #expect(model.copyText == web.copy)
            #expect(model.copied(true).map { $0.map(\.text).joined() }
                == ["\(web.copied.said) \(Words.Lineup.setItOn) \(web.copied.page)."])
        }
    }

    @Test func theMovesWordsAreTheWebsForEveryPlatform() {
        for web in Self.parity.moves {
            let platform = ValueWords.platform(.init(value1: .init(rawValue: web.host)))
            #expect(StartWords.setItOn(platform) == web.verb)
            #expect(StartWords.reading(platform) == web.reading)
            #expect(StartWords.setting(platform) == web.setting)
            #expect(StartWords.open(platform) == web.open)
            #expect(StartWords.lost(platform) == web.lost)
            for result in web.results {
                #expect(result.words == result.sentence)
                #expect(result.hostWords.map { StartWords.hostSaid(platform, $0) } == result.said)
            }
        }
    }
}

/// shared/fixtures/parity/lineup.json, as the web's readers wrote it.
struct LineupParity: Decodable {
    struct Sum: Decodable, Equatable {
        let figure: String
        let words: String
        let gain: String?
        let final: String?
    }

    struct Swap: Decodable {
        let words: String
    }

    struct Status: Decodable, Equatable {
        let mark: String
        let sits: Bool
    }

    struct Game: Decodable, Equatable {
        let place: String
        let when: String

        enum CodingKeys: String, CodingKey {
            case place = "where"
            case when
        }
    }

    /// A row's game: "bye", "no-club", the game's halves, or null.
    enum RowGameCell: Decodable, Equatable {
        case game(Game)
        case word(String)
        case none

        init(from decoder: any Decoder) throws {
            let container = try decoder.singleValueContainer()
            if container.decodeNil() {
                self = .none
            } else if let word = try? container.decode(String.self) {
                self = .word(word)
            } else {
                self = try .game(container.decode(Game.self))
            }
        }

        init(_ game: RowGame) {
            switch game {
            case let .game(place, when): self = .game(Game(place: place, when: when))
            case .bye: self = .word("bye")
            case .noClub: self = .word("no-club")
            case .none: self = .none
            }
        }
    }

    struct Weather: Decodable, Equatable {
        let glyph: String
        let words: String
    }

    struct Row: Decodable, Equatable {
        let key: String
        let slot: String
        let move: String?
        let idle: Bool
        let name: String
        let fit: String
        let slug: String?
        let club: String
        let position: String
        let status: Status?
        let rank: String
        let game: RowGameCell
        let note: String?
        let expected: String?
        let weather: Weather?
        let proj: String
        let pts: String
        let evidence: String
        let oppRank: String?
        let ease: String
        let state: String?
        let why: String?

        init(_ cells: RowCells) {
            let row = cells.row
            key = row.id
            slot = row.slot
            move = cells.move?.rawValue
            idle = cells.idle
            name = row.name
            fit = row.fit
            slug = row.slug
            club = row.club
            position = row.position
            status = row.status.map { Status(mark: $0.mark, sits: $0.sits) }
            rank = cells.rank
            game = RowGameCell(cells.game)
            note = cells.note
            expected = row.expected
            weather = row.weather.map { Weather(glyph: $0.glyph, words: $0.words) }
            proj = cells.proj
            pts = cells.pts
            evidence = cells.evidence
            oppRank = cells.oppRank
            ease = cells.ease.rawValue
            state = row.read.stateName
            why = cells.why
        }

        init(from decoder: any Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            key = try values.decode(String.self, forKey: .key)
            slot = try values.decode(String.self, forKey: .slot)
            move = try values.decodeIfPresent(String.self, forKey: .move)
            idle = try values.decode(Bool.self, forKey: .idle)
            name = try values.decode(String.self, forKey: .name)
            fit = try values.decode(String.self, forKey: .fit)
            slug = try values.decodeIfPresent(String.self, forKey: .slug)
            club = try values.decode(String.self, forKey: .club)
            position = try values.decode(String.self, forKey: .position)
            status = try values.decodeIfPresent(Status.self, forKey: .status)
            rank = try values.decode(String.self, forKey: .rank)
            game = try values.decode(RowGameCell.self, forKey: .game)
            note = try values.decodeIfPresent(String.self, forKey: .note)
            expected = try values.decodeIfPresent(String.self, forKey: .expected)
            weather = try values.decodeIfPresent(Weather.self, forKey: .weather)
            proj = try values.decode(String.self, forKey: .proj)
            pts = try values.decode(String.self, forKey: .pts)
            evidence = try values.decode(String.self, forKey: .evidence)
            oppRank = try values.decodeIfPresent(String.self, forKey: .oppRank)
            ease = try values.decode(String.self, forKey: .ease)
            state = try values.decodeIfPresent(String.self, forKey: .state)
            why = try values.decodeIfPresent(String.self, forKey: .why)
        }

        enum CodingKeys: String, CodingKey {
            case key, slot, move, idle, name, fit, slug, club, position, status, rank, game, note, expected, weather
            case proj, pts, evidence, oppRank, ease, state, why
        }
    }

    struct Team: Decodable {
        let note: String?
        let live: Bool
        let caption: String?
        let proj: String
        let pts: String
    }

    struct Pinned: Decodable {
        let verb: String?
        let page: String?
        let line: String?
    }

    struct Change: Decodable, Equatable {
        let slot: String
        let player: String
        let out: String?

        enum CodingKeys: String, CodingKey {
            case slot
            case player = "in"
            case out
        }
    }

    struct Copied: Decodable {
        let said: String
        let page: String
    }

    struct Clock: Decodable {
        let week: Int
        let title: String
        let decision: String
        let sum: Sum?
        let done: String?
        let missed: String?
        let chipsShown: Bool
        let idle: [String]
        let swaps: [Swap]
        let starters: [Row]
        let empty: [String]
        let team: Team
        let bench: [Row]
        let reserve: [Row]
        let pinned: Pinned
        let changes: [Change]
        let copy: String
        let copied: Copied
        let basis: String
    }

    struct Result: Decodable {
        let outcome: String
        let sentence: String
        let hostWords: String?
        let words: String
        let said: String?
    }

    struct Moves: Decodable {
        let host: String
        let verb: String
        let reading: String
        let setting: String
        let open: String
        let lost: String
        let results: [Result]
    }

    let clocks: [String: Clock]
    let writes: [String: Clock]
    let moves: [Moves]
}
