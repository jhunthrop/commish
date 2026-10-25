import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// The Waivers port held to the web's Waivers at 390 (shared/fixtures/parity/waivers.json): the strip,
/// the line under the heads, every row's cells and Beats cell in the table's order, each row's verb, the
/// drop panels, the pinned verb with its line, the arrival line and the phone's basis at all six fixture
/// clocks on the FFPC stand-in and at the week's clock on each ESPN stand-in; and the claim's words for
/// every platform, each outcome, the bid's label and its problems.
struct WaiverParityTests {
    static let parity: WaiversParity = {
        do {
            return try JSONDecoder().decode(WaiversParity.self, from: Fixtures.data("fixtures/parity/waivers.json"))
        } catch {
            preconditionFailure("shared/fixtures/parity/waivers.json does not read: \(error)")
        }
    }()

    /// Each screen the parity holds: the FFPC stand-in at each clock, each ESPN stand-in at the week's.
    static let screens: [String] = StartParityTests.clocks + ["done", "refused", "pending"]

    static func web(_ name: String) throws -> WaiversParity.Screen {
        try #require(parity.clocks[name] ?? parity.espn[name]?.screen)
    }

    static func model(_ name: String) throws -> WaiverModel {
        if let espn = parity.espn[name] {
            return try WaiverModel(
                advice: Fixtures.waivers(espn.id, parity.espnClock), host: .init(value1: .espn),
                now: Fixtures.instant(parity.espnClock), zone: Fixtures.zone
            )
        }
        return try WaiverModel(
            advice: Fixtures.waivers(Fixtures.league, name), host: Fixtures.sync().host,
            now: Fixtures.instant(name), zone: Fixtures.zone
        )
    }

    @Test(arguments: screens)
    func theStripIsTheWebs(name: String) throws {
        let web = try Self.web(name)
        let model = try Self.model(name)
        #expect(model.week == "Week \(web.week)")
        #expect(model.title == web.title)
        #expect(model.decision == web.decision)
        #expect(model.sum.map { WaiversParity.Sum(figure: $0.figure, words: $0.words, gain: $0.gain) } == web.sum)
        #expect(model.cards.map(WaiversParity.Card.init) == web.cards)
    }

    @Test(arguments: screens)
    func theHeadsTheRowsAndTheirGroupsAreTheWebs(name: String) throws {
        let web = try Self.web(name)
        let model = try Self.model(name)
        #expect(model.projected == web.projected)
        #expect(model.arrives == web.arrives)
        #expect(model.heads == web.heads)
        #expect(model.gaining.map { WaiversParity.Row($0, model) } == web.gaining)
        #expect(model.rest.map { WaiversParity.Row($0, model) } == web.rest)
        #expect(model.stash.map { WaiversParity.Row($0, model) } == web.stash)
        #expect(model.stashLine == web.stashLine)
    }

    @Test(arguments: screens)
    func everyDropPanelIsTheWebs(name: String) throws {
        let web = try Self.web(name)
        let model = try Self.model(name)
        #expect(web.drops.isEmpty == false)
        for (key, panel) in web.drops {
            let row = try #require(model.rows.first { $0.key == key }, "\(key)")
            let drops = model.drops(row)
            let head = model.dropHead(row)
            #expect(head.title == panel.title)
            #expect(head.lead == panel.lead)
            #expect(drops.map(WaiversParity.Drop.init) == panel.rows)
            #expect(model.pairWords(row.source, drop: drops.first) == panel.pair)
        }
    }

    @Test(arguments: screens)
    func thePinnedVerbItsLineAndTheBasisAreTheWebs(name: String) throws {
        let web = try Self.web(name)
        let model = try Self.model(name)
        #expect(model.cards.first.map { model.verb($0.source) } == web.pinned.verb)
        #expect(model.line == web.pinned.line)
        #expect(model.page?.absoluteString ?? "" == web.pinned.url)
        #expect(model.basis == web.basis)
        if let card = model.cards.first, let copied = web.copied, let failed = web.copyFailed {
            let said = WaiverWords.copied(model.platform, name: model.shortName(card.source), didCopy: true)
            let not = WaiverWords.copied(model.platform, name: model.shortName(card.source), didCopy: false)
            #expect([said.said, said.page] == [copied.said, copied.page])
            #expect([not.said, not.page] == [failed.said, failed.page])
        }
    }

    @Test func everyLineOfTheTableCarriesTheAPIsGameState() throws {
        for name in Self.screens {
            let model = try Self.model(name)
            let lines = model.advice.rows.map(\.add) + model.advice.roster
            #expect(lines.allSatisfy { $0.gameState?.value1.state.value1 != nil }, "\(name)")
        }
    }

    @Test func theClaimsWordsAreTheWebsForEveryPlatform() {
        let zone = Fixtures.zone
        #expect(Words.Move.claimTitle == Self.parity.claim.title)
        for web in Self.parity.claim.hosts {
            let platform = ValueWords.platform(.init(value1: .init(rawValue: web.host)))
            let kind = MoveKind.claim(zone: zone)
            #expect(kind.verb(platform) == web.verb)
            #expect(kind.reading(platform) == web.reading)
            #expect(kind.setting(platform) == web.setting)
            #expect(StartWords.open(platform) == web.open)
            #expect(kind.lost(platform) == web.lost)
            for result in web.results {
                let made = HostMoveResult(
                    outcome: .init(value1: .init(rawValue: result.outcome)), sentence: result.sentence,
                    hostWords: result.hostWords, hostUrl: "", moveId: nil,
                    processesAt: result.processesAt.flatMap(APIDecoding.parseDate)
                )
                #expect(kind.result(platform, made) == result.words)
                #expect(result.hostWords.map { StartWords.hostSaid(platform, $0) } == result.said)
            }
            for terms in web.bids {
                let bid = terms.bid
                let hostBid = HostBid(amount: bid.amount, min: bid.min, max: bid.max, leftKnown: bid.leftKnown)
                #expect(WaiverWords.bidLabel(hostBid) == terms.label)
                for problem in terms.problems {
                    #expect(
                        WaiverWords.bidProblem(platform, typed: problem.typed, bid: hostBid) == problem.problem,
                        "\(web.host) \(problem.typed)"
                    )
                }
            }
        }
    }

    @Test func aClearingDayAndAStashsWeekReadAsTheWebs() {
        #expect(WaiverWords.clears("2026-10-21") == "Clears Wed")
        #expect(WaiverWords.clears(nil) == nil)
        #expect(WaiverWords.back(9, addressed: 7) == "Back week 9")
        #expect(WaiverWords.back(7, addressed: 7) == "Back this week")
    }
}

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

    struct Screen: Decodable {
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
    let claim: Claim
}
