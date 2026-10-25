@testable import CommishCore
import Foundation

/// shared/fixtures/parity/waivers.json, as the web's Waivers wrote it.
struct WaiversParity: Decodable {
    struct Sum: Decodable, Equatable {
        let figure: String
        let words: String
        let gain: String
    }

    struct Card: Decodable, Equatable {
        let key: String
        let slot: String
        let mark: String?
        let move: String
        let why: String?
        let gains: String
        let verb: String

        init(_ card: PickupCard) {
            key = card.key
            slot = card.slot
            mark = card.mark
            move = card.move
            why = card.why
            gains = card.gains
            verb = card.verb
        }
    }

    struct Who: Decodable, Equatable {
        let name: String
        let place: String
    }

    struct Beats: Decodable, Equatable {
        let who: Who?
        let figure: String?
        let loud: Bool
        let week: String?
    }

    /// A row as the table draws it: the box row's cells the Lineup's parity holds, then the Waivers' own.
    struct Row: Decodable, Equatable {
        let key: String
        let name: String
        let fit: String
        let slug: String?
        let club: String
        let position: String
        let status: LineupParity.Status?
        let rank: String
        let game: LineupParity.RowGameCell
        let proj: String
        let evidence: String
        let oppRank: String?
        let ease: String
        let state: String?
        let rest: String
        let clears: String?
        let away: String?
        let named: Bool
        let gains: Bool
        let beats: Beats
        let button: String
        let opensPage: Bool
        let verb: String
        let claimsHere: Bool

        init(_ pool: PoolRow, _ model: WaiverModel) {
            let cells = pool.cells
            let row = cells.row
            key = pool.key
            name = row.name
            fit = row.fit
            slug = row.slug
            club = row.club
            position = row.position
            status = row.status.map { LineupParity.Status(mark: $0.mark, sits: $0.sits) }
            rank = cells.rank
            game = LineupParity.RowGameCell(cells.game)
            proj = cells.proj
            evidence = pool.evidence
            oppRank = cells.oppRank
            ease = cells.ease.rawValue
            state = row.read.stateName
            rest = StartWords.number(pool.stash == nil
                ? pool.source.add.restOfSeasonPerGame : pool.source.stash?.value1.perGame)
            clears = pool.clears
            away = pool.away
            named = pool.named
            gains = pool.gains
            beats = Beats(
                who: pool.beats.who.map { Who(name: $0.name, place: $0.place) }, figure: pool.beats.figure,
                loud: pool.beats.loud, week: pool.beats.week
            )
            button = pool.button
            opensPage = pool.opensPage
            verb = model.verb(pool.source)
            claimsHere = model.claimsHere(pool.source)
        }
    }

    struct Drop: Decodable, Equatable {
        let key: String
        let evidence: String
        let gain: String
        let week: String?
        let starter: String?

        init(_ drop: DropRow) {
            key = drop.key
            evidence = drop.evidence
            gain = drop.gain
            week = drop.week
            starter = drop.starter
        }
    }

    struct Panel: Decodable {
        let title: String
        let lead: String
        let rows: [Drop]
        let pair: String
    }

    struct Pinned: Decodable {
        let verb: String?
        let line: String
        let url: String
    }

    struct Copied: Decodable {
        let said: String
        let page: String
    }

    struct Chip: Decodable, Equatable {
        let position: String
        let word: String
    }

    struct Keys: Decodable {
        let key: String
        let down: Bool
        let gaining: [String]
        let rest: [String]
        let stash: [String]
    }

    struct Found: Decodable {
        let query: String
        let gaining: [String]
        let rest: [String]
        let stash: [String]
    }

    struct Step: Decodable, Equatable {
        let key: String
        let down: Bool
    }

    struct Stashed: Decodable {
        let screen: Screen
    }

    struct Screen: Decodable {
        let positions: [Chip]
        let sorts: [Keys]
        let finds: [Found]
        let empty: String
        let week: Int
        let title: String
        let decision: String
        let sum: Sum?
        let cards: [Card]
        let projected: Bool
        let arrives: String?
        let heads: String
        let gaining: [Row]
        let rest: [Row]
        let stash: [Row]
        let stashLine: [String]
        let drops: [String: Panel]
        let pinned: Pinned
        let copied: Copied?
        let copyFailed: Copied?
        let basis: String
    }

    struct Espn: Decodable {
        let id: String
        let screen: Screen
    }

    struct Bid: Decodable {
        let amount: Int
        let min: Int
        let max: Int
        let leftKnown: Bool

        enum CodingKeys: String, CodingKey {
            case amount, min, max
            case leftKnown = "left_known"
        }
    }

    struct Problem: Decodable {
        let typed: String
        let problem: String?
    }

    struct BidTerms: Decodable {
        let bid: Bid
        let label: String
        let problems: [Problem]
    }

    struct Result: Decodable {
        let outcome: String
        let sentence: String
        let processesAt: String?
        let hostWords: String?
        let words: String
        let said: String?
    }

    struct Host: Decodable {
        let host: String
        let verb: String
        let reading: String
        let setting: String
        let open: String
        let lost: String
        let results: [Result]
        let bids: [BidTerms]
    }

    struct Claim: Decodable {
        let title: String
        let hosts: [Host]
    }

    let clocks: [String: Screen]
    let espnClock: String
    let espn: [String: Espn]
    let narrowed: [String: Screen]
    let stashed: [String: Stashed]
    let sortSteps: [Step]
    let claim: Claim
}
