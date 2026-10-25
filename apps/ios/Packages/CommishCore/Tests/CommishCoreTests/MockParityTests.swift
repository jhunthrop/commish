import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// The mock room's port held to the web's room at 390 (shared/fixtures/parity/mock.json), through the
/// view model over the recorded draft played in order as the room plays it: at every answer the bar, our
/// call, the strip since your pick, the pool under every chip, the wall and the team; the undo's line;
/// the turn with no call; a shared draft's head and pool; the setup; and the three reports.
@MainActor
struct MockParityTests {
    typealias JSON = [String: Any]

    static let parity: JSON = {
        guard let data = try? MockFixture.parity(),
              let object = try? JSONSerialization.jsonObject(with: data) as? JSON
        else {
            preconditionFailure("shared/fixtures/parity/mock.json does not read")
        }
        return object
    }()

    static let clock = FixedClock(Date(timeIntervalSince1970: 1_792_000_000))

    static func cache() -> FileCache {
        FileCache(folder: FileManager.default.temporaryDirectory.appendingPathComponent("mock-\(UUID().uuidString)"))
    }

    /// The states in the order a room reaches them, each with the step that reaches it.
    enum Step: String, CaseIterable, Sendable {
        case create
        case pick1 = "pick-1"
        case pick2 = "pick-2"
        case pick3 = "pick-3"
        case pick4 = "pick-4"
        case round5
        case queue
        case undo
        case pickAgain = "pick-again"
        case autopick
    }

    /// The view model after playing the draft through `step`: the first mock from its first turn by
    /// hand to 5.05; then opened again at 5.05, a player queued, 4.08 taken back and drafted again, and
    /// Pick for me through round 8.
    static func played(through step: Step) async -> (MockRoomViewModel, StubMock) {
        let all = Step.allCases
        let index = all.firstIndex(of: step) ?? 0
        let fromRound5 = index >= all.firstIndex(of: .round5) ?? 0
        let api = StubMock(opened: fromRound5 ? .round5 : .create)
        let viewModel = MockRoomViewModel(id: MockFixture.id, api: api, cache: cache(), clock: clock)
        await viewModel.load()
        let start = fromRound5 ? all.firstIndex(of: .round5) ?? 0 : 0
        let steps = index > start ? Array(all[(start + 1) ... index]) : []
        for next in steps {
            switch next {
            case .pick1, .pick2, .pick3, .pick4, .pickAgain: await viewModel.draft()
            case .queue: await viewModel.toggleQueue((try? MockFixture.room(.queue).queue.first) ?? "")
            case .undo: await viewModel.undo()
            case .autopick: await viewModel.autopick()
            case .create, .round5: break
            }
        }
        return (viewModel, api)
    }

    static func model(_ viewModel: MockRoomViewModel) throws -> MockRoomModel {
        guard case let .room(model, _) = viewModel.state else {
            Issue.record("the room did not draw: \(viewModel.state)")
            throw ParityError.notRoom
        }
        return model
    }

    static func web(_ step: Step) throws -> JSON {
        let states = try #require(parity["states"] as? JSON)
        return try #require(states[step.rawValue] as? JSON)
    }

    enum ParityError: Error {
        case notRoom
    }

    @Test(arguments: Step.allCases)
    func theBarAndTheCallAreTheWebs(step: Step) async throws {
        let (viewModel, _) = await Self.played(through: step)
        let model = try Self.model(viewModel)
        let web = try Self.web(step)
        #expect(model.room.pickNumber == web["pick"] as? Int)
        let bar = try #require(model.bar)
        #expect(bar.head == web["head"] as? String)
        let cells = try #require(web["cells"] as? [JSON])
        #expect(bar.cells.map(\.label) == cells.map { $0["label"] as? String })
        #expect(bar.cells.map(\.value) == cells.map { $0["value"] as? String })
        #expect(bar.cells.map(\.word) == cells.map { $0["word"] as? Bool })
        #expect(bar.autopick == web["autopick"] as? String)
        #expect(bar.undoPick == web["lastMine"] as? Int)
        let call = try #require(web["call"] as? JSON)
        guard case let .call(made, player) = model.call else {
            Issue.record("\(step): no call drawn")
            return
        }
        let rows = try #require(call["rows"] as? [JSON])
        #expect(made.tag == call["tag"] as? String)
        #expect(made.chanceHead == call["chanceHead"] as? String)
        #expect(made.verb == call["verb"] as? String)
        #expect(made.rows.map(\.player.id) == rows.map { $0["id"] as? String })
        #expect(made.rows.map(\.value) == rows.map { $0["value"] as? String })
        #expect(made.rows.map(\.chance) == rows.map { $0["chance"] as? String })
        #expect(player == rows.first?["id"] as? String)
    }

    @Test(arguments: Step.allCases)
    func theStripSinceYourPickIsTheWebs(step: Step) async throws {
        let (viewModel, _) = await Self.played(through: step)
        let model = try Self.model(viewModel)
        guard let since = try Self.web(step)["since"] as? JSON else {
            #expect(model.since == nil && model.straight == nil)
            return
        }
        if let straight = since["straight"] as? String {
            #expect(model.straight == straight)
            #expect(model.since == nil)
            return
        }
        let strip = try #require(model.since)
        let faces = try #require(since["faces"] as? [JSON])
        #expect(strip.lead == since["lead"] as? String)
        #expect(strip.lines == since["lines"] as? [String])
        #expect(strip.picks.map(\.id) == faces.map { $0["pick"] as? Int })
        #expect(strip.picks.map(\.name) == faces.map { $0["name"] as? String })
        #expect(strip.picks.map(\.lines) == faces.map { $0["lines"] as? [String] })
    }

    @Test(arguments: Step.allCases)
    func thePoolUnderEveryChipIsTheWebs(step: Step) async throws {
        let (viewModel, _) = await Self.played(through: step)
        let web = try #require(try Self.web(step)["pool"] as? JSON)
        let filters = try #require(web["filters"] as? [JSON])
        #expect(try Self.model(viewModel).pool?.filters == filters.compactMap { $0["filter"] as? String })
        for chip in filters {
            let filter = try #require(chip["filter"] as? String)
            viewModel.choose(filter: filter)
            let pool = try #require(try Self.model(viewModel).pool)
            #expect(pool.model.line == web["line"] as? String)
            #expect(pool.model.basis == web["basis"] as? String)
            #expect(pool.model.chanceLabel == web["chanceLabel"] as? String)
            #expect(pool.model.missing == web["missing"] as? String)
            #expect(pool.rows.count == chip["count"] as? Int, "\(filter)")
            #expect(pool.empty == chip["empty"] as? String)
            let rows = try #require(chip["rows"] as? [JSON])
            let first = pool.rows.prefix(PoolModel.firstRows)
            #expect(first.map(\.id) == rows.map { $0["id"] as? String }, "\(filter)")
            #expect(first.map(\.line.value) == rows.map { ($0["value"] as? JSON)?["text"] as? String })
            #expect(first.map { $0.line.heat?.name } == rows.map { ($0["value"] as? JSON)?["heat"] as? String })
            #expect(first.map(\.line.chance) == rows.map { $0["chance"] as? String })
            #expect(first.map(\.line.isCall) == rows.map { $0["call"] as? Bool })
            #expect(first.map(\.queued) == rows.map { $0["queued"] as? Bool })
        }
    }

    @Test(arguments: Step.allCases)
    func theWallAndTheTeamAreTheWebs(step: Step) async throws {
        let (viewModel, _) = await Self.played(through: step)
        let model = try Self.model(viewModel)
        let web = try Self.web(step)
        let wall = try #require(web["wall"] as? JSON)
        #expect(model.wall.names == wall["names"] as? [String])
        let rows = try #require(wall["rows"] as? [[Any]])
        #expect(model.wall.rows.map { $0.map { $0?.id } } == rows.map { $0.map { $0 as? String } })
        let team = try #require(web["team"] as? JSON)
        let slots = try #require(team["slots"] as? [JSON])
        #expect(model.team.count == team["count"] as? String)
        #expect(model.team.slots.map(\.slot) == slots.map { $0["slot"] as? String })
        #expect(model.team.slots.map { $0.player?.id } == slots.map { $0["id"] as? String })
        #expect(model.team.slots.map(\.pick) == slots.map { $0["pick"] as? String })
    }

    @Test func theUndoSaysWhereTheRoomWentBack() async throws {
        let (viewModel, api) = await Self.played(through: .undo)
        let undo = try #require(Self.parity["undo"] as? JSON)
        #expect(await api.undone == [undo["pick"] as? Int])
        #expect(try Self.model(viewModel).notice == undo["words"] as? String)
    }

    @Test func aPickInFlightReadsTheRoomForTheNextTurn() throws {
        let room = try MockFixture.room(.create)
        let board = try RoomBoardView(#require(room.board?.value1), teams: room.teams)
        var ui = MockRoomUI()
        ui.busy = true
        ui.draftedAt = room.pickNumber
        let web = try Self.web(.create)
        let model = MockRoomModel(room: room, board: board, card: nil, ui: ui)
        guard case let .reading(frame, words) = model.call else {
            Issue.record("no reading frame: \(String(describing: model.call))")
            return
        }
        #expect(words == web["reading"] as? String)
        #expect(frame.rows.map(\.player.id) == web["frame"] as? [String])
    }

    @Test func aTurnWithNoCallDraftsFromThePoolsTopRow() throws {
        let room = try MockFixture.room(.create)
        let board = try RoomBoardView(#require(room.board?.value1), teams: room.teams)
        var ui = MockRoomUI()
        ui.callMissing = true
        let web = try #require(Self.parity["noCall"] as? JSON)
        let model = MockRoomModel(room: room, board: board, card: nil, ui: ui)
        guard case let .noCall(verb, player) = model.call else {
            Issue.record("not the no-call state")
            return
        }
        #expect(player == RoomDraft.pool(board, drafted: Set(room.picks.map(\.playerId)), filter: "All").first?.id)
        #expect(model.pool?.model.basis == web["basis"] as? String)
        #expect(model.pool?.model.missing == web["missing"] as? String)
        #expect(verb == web["verb"] as? String)
    }

    @Test func aSharedDraftsHeadAndPoolAreTheWebs() async throws {
        let viewModel = SharedMockViewModel(code: "code", api: StubMock(opened: .sharedRound5))
        await viewModel.load()
        guard case let .room(model) = viewModel.state else {
            Issue.record("no shared room: \(viewModel.state)")
            return
        }
        let web = try #require(Self.parity["shared"] as? JSON)
        let head = try #require(model.shared)
        #expect(head.title == web["title"] as? String)
        #expect(head.line == web["line"] as? String)
        #expect(head.verb == web["verb"] as? String)
        #expect(head.note == web["note"] as? String)
        #expect(model.bar == nil && model.call == nil)
        let room = try #require(web["room"] as? JSON)
        let wall = try #require(room["wall"] as? JSON)
        #expect(model.wall.names == wall["names"] as? [String])
        let pool = try #require(room["pool"] as? JSON)
        let filters = try #require(pool["filters"] as? [JSON])
        #expect(model.pool?.filters == filters.compactMap { $0["filter"] as? String })
        #expect(model.pool?.model.basis == pool["basis"] as? String)
        #expect(model.pool?.rows.prefix(PoolModel.firstRows).map(\.id)
            == (filters.first?["rows"] as? [JSON])?.map { $0["id"] as? String })
        #expect(model.pool?.rows.allSatisfy { $0.line.chance == nil } == true)
    }

    @Test func theSetupIsTheWebs() {
        let web = Self.parity["setup"] as? JSON ?? [:]
        let viewModel = MockSetupViewModel(api: StubMock())
        #expect(Words.Mock.setupTitle == web["title"] as? String)
        #expect(viewModel.cells.map(\.label) == (web["cells"] as? [JSON])?.map { $0["label"] as? String })
        #expect(viewModel.cells.map(\.value) == (web["cells"] as? [JSON])?.map { $0["value"] as? String })
        #expect(MockSetup.scoring.map(\.label) == web["scoring"] as? [String])
        #expect(MockSetup.lineups.map(\.label) == web["lineups"] as? [String])
        #expect(MockSetup.teams == web["teams"] as? [Int])
        #expect(MockWords.formatLine(viewModel.settings) == web["line"] as? String)
        #expect(Words.Mock.start == web["start"] as? String)
    }

    static func checkReport(_ model: DraftReportModel, _ web: JSON) throws {
        #expect(model.title == web["title"] as? String)
        #expect(model.points == web["points"] as? String)
        #expect(model.caption == web["caption"] as? String)
        let cells = try #require(web["cells"] as? [JSON])
        #expect(model.cells.map(\.label) == cells.map { $0["label"] as? String })
        #expect(model.cells.map(\.value) == cells.map { $0["value"] as? String })
        #expect(model.cells.map(\.mine) == cells.map { $0["mine"] as? Bool })
        #expect(model.basis == web["basis"] as? String)
        let field = try #require(web["field"] as? JSON)
        #expect(model.fieldNote == field["note"] as? String)
        let teams = try #require(field["rows"] as? [JSON])
        #expect(model.field.map(\.name) == teams.map { $0["name"] as? String })
        #expect(model.field.map(\.points) == teams.map { $0["points"] as? String })
        let picks = try #require(web["picks"] as? JSON)
        #expect(model.picksNote == picks["note"] as? String)
        let rows = try #require(picks["rows"] as? [JSON])
        #expect(model.picks.map(\.pick) == rows.map { $0["pick"] as? String })
        #expect(model.picks.map(\.slot) == rows.map { $0["slot"] as? String })
        #expect(model.picks.map(\.madeBy) == rows.map { $0["by"] as? String })
        #expect(model.picks.map(\.still) == rows.map { ($0["still"] as? JSON)?["text"] as? String })
        let runs = try #require(web["runs"] as? JSON)
        #expect(model.runs.title == runs["title"] as? String)
        #expect(model.runs.note == runs["note"] as? String)
        #expect(model.runs.middle == runs["middle"] as? String)
        #expect(model.runs.topWords == runs["topWords"] as? String)
        let exposure = try #require(web["exposure"] as? JSON)
        #expect(model.exposureTitle == exposure["title"] as? String)
    }

    @Test func theReportAtFirstIsTheWebs() async throws {
        let (viewModel, _) = await Self.played(through: .autopick)
        await viewModel.finish()
        guard case let .report(model, code, _, slot) = viewModel.state else {
            Issue.record("no report: \(viewModel.state)")
            return
        }
        let web = try #require((Self.parity["reports"] as? JSON)?["first"] as? JSON)
        try Self.checkReport(model, web)
        #expect([MockWords.runAgain(slot), Words.Mock.tryAnother, Words.Mock.copyLink] == web["verbs"] as? [String])
        #expect(code != nil)
    }

    @Test func theReportWellDownIsTheWebs() throws {
        let report = try MockFixture.report("report-down")
        let model = DraftReportModel(
            report, names: MockWords.seatNames(teams: report.teams, slot: report.slot),
            seats: Words.Mock.botsByAdp, reshuffled: Words.Mock.reshuffled
        )
        try Self.checkReport(model, #require((Self.parity["reports"] as? JSON)?["down"] as? JSON))
    }

    @Test func aSharedReportSpeaksOfItsDrafter() async throws {
        let viewModel = SharedMockViewModel(code: "code", api: StubMock(opened: .sharedComplete))
        await viewModel.load()
        guard case let .report(model, verb) = viewModel.state else {
            Issue.record("no shared report: \(viewModel.state)")
            return
        }
        let web = try #require((Self.parity["reports"] as? JSON)?["shared"] as? JSON)
        try Self.checkReport(model, web)
        #expect(verb == (web["verbs"] as? [String])?.first)
    }
}
