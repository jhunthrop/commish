import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import Testing

/// The Waivers port held to the web's Waivers at 390 (shared/fixtures/parity/waivers.json): the strip,
/// the line under the heads, every row's cells and Beats cell in the table's order, each row's verb, the
/// drop panels, the pinned verb with its line, the arrival line and the phone's basis at all six fixture
/// clocks on the FFPC stand-in and at the week's clock on each ESPN stand-in; and the claim's words for
/// every platform, each outcome, the bid's label and its problems. Then the D/ST chip's read over the
/// page's answer, the Stash group and a clearing day over stash.test.ts's inputs, and every screen's
/// chips, sorts and searches.
struct WaiverParityTests {
    static let parity: WaiversParity = {
        do {
            return try JSONDecoder().decode(WaiversParity.self, from: Fixtures.data("fixtures/parity/waivers.json"))
        } catch {
            preconditionFailure("shared/fixtures/parity/waivers.json does not read: \(error)")
        }
    }()

    /// Each screen the parity holds: the FFPC stand-in at each clock, each ESPN stand-in at the week's.
    static let screens: [String] = StartParityTests.clocks + ["done", "refused", "pending", "DEF"]
        + ["withSlot", "noSlot", "benchOpen"]

    static func web(_ name: String) throws -> WaiversParity.Screen {
        try #require(
            parity.clocks[name] ?? parity.espn[name]?.screen ?? parity.narrowed[name]
                ?? parity.stashed[name]?.screen
        )
    }

    /// A synthetic answer the parity file carries (the Stash cases), read as the API sends it.
    static func synthetic(_ name: String) throws -> WaiverAdvice {
        let file = try JSONSerialization.jsonObject(with: Fixtures.data("fixtures/parity/waivers.json"))
        let stashed = try #require((file as? [String: Any])?["stashed"] as? [String: Any])
        let advice = try #require((stashed[name] as? [String: Any])?["advice"])
        let envelope = try JSONSerialization.data(withJSONObject: ["ok": true, "data": advice])
        return try APIDecoding.envelopeData(WaiverAdvice.self, from: envelope)
    }

    static func model(_ name: String) throws -> WaiverModel {
        let week = Fixtures.instant(Fixtures.week)
        if parity.narrowed[name] != nil {
            return try WaiverModel(
                advice: Fixtures.waivers(Fixtures.league, Fixtures.week),
                shown: Fixtures.waivers(Fixtures.league, "\(name)-\(Fixtures.week)"), host: Fixtures.sync().host,
                now: week, zone: Fixtures.zone
            )
        }
        if parity.stashed[name] != nil {
            return try WaiverModel(advice: synthetic(name), host: Fixtures.sync().host, now: week, zone: Fixtures.zone)
        }
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

    @Test(arguments: screens)
    func theChipsEverySortAndEverySearchAreTheWebs(name: String) throws {
        let web = try Self.web(name)
        let model = try Self.model(name)
        #expect(model.positions.map { WaiversParity.Chip(position: $0.position.rawValue, word: $0.word) }
            == web.positions)
        for sort in web.sorts {
            let key = try #require(WaiverSortKey(rawValue: sort.key))
            let table = model.table(WaiverSort(key: key, down: sort.down))
            #expect(table.gaining.map(\.key) == sort.gaining, "\(name) \(sort.key) \(sort.down)")
            #expect(table.rest.map(\.key) == sort.rest, "\(name) \(sort.key) \(sort.down)")
            #expect(table.stash.map(\.key) == sort.stash, "\(name) \(sort.key) \(sort.down)")
        }
        for find in web.finds {
            let table = model.table(query: find.query)
            #expect(
                [table.gaining.map(\.key), table.rest.map(\.key), table.stash.map(\.key)]
                    == [find.gaining, find.rest, find.stash],
                "\(name) \(find.query)"
            )
        }
        #expect(Words.Waivers.noneFound == web.empty)
    }

    @Test func eachHeadChosenInTurnSortsAsTheWebs() {
        let keys: [WaiverSortKey] = [.name, .name, .proj, .proj, .beats, .game]
        var sort = WaiverSort.initial
        var steps: [WaiversParity.Step] = []
        for key in keys {
            sort = sort.next(key)
            steps.append(WaiversParity.Step(key: sort.key.rawValue, down: sort.down))
        }
        #expect(steps == Self.parity.sortSteps)
    }

    @Test func theStashCasesHoldEachVerbAndAClearingDay() throws {
        let slot = try Self.web("withSlot")
        #expect(slot.stash.map(\.button) == ["Stash", "Add"])
        #expect(slot.stash.first?.clears == "Clears Thu")
        #expect(slot.gaining.contains { $0.clears == "Clears Wed" } || slot.rest.contains { $0.clears == "Clears Wed" })
        let open = try Self.web("benchOpen")
        #expect(open.stash.first?.opensPage == true)
        #expect(open.stash.first?.beats.who == WaiversParity.Who(name: "IR slot", place: "Open"))
        #expect(try Self.web("noSlot").stash.allSatisfy { $0.button == "Add" })
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
