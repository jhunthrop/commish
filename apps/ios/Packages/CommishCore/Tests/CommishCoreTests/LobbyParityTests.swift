import CommishAPI
@testable import CommishCore
import CommishDesign
import Foundation
import RunFixtures
import Testing

/// The lobby's port held to the web's lobby at 390 (shared/fixtures/parity/lobby.json): the recorded
/// socket's frames replayed in order as the page applies them, and at each drawn state the replayed
/// state itself, the score bug on the room's clock, the seats strip, the filling line, the strip of
/// picks as they land, our call and its verb, the pool under every chip, the wall, the team and the
/// dock's line; the room at its end; the landing's cards; the two reports.
@MainActor
struct LobbyParityTests {
    typealias JSON = [String: Any]

    static let parity: JSON = {
        guard let data = try? LobbyFixture.parity(),
              let object = try? JSONSerialization.jsonObject(with: data) as? JSON
        else {
            preconditionFailure("shared/fixtures/parity/lobby.json does not read")
        }
        return object
    }()

    nonisolated static let states = ["filling", "started", "yourTurn", "between", "round2", "round3"]

    /// The recorded frames' rows, each frame's index in the exchange with the rows it carried.
    static func frames() throws -> [(index: Int, rows: [RoomRow])] {
        try LobbyFixture.steps().enumerated().compactMap { index, step in
            guard case let .server(text) = step, let frame = try RoomFrame.decode(text) else {
                return nil
            }
            switch frame {
            case let .welcome(_, _, rows), let .update(_, rows): return (index, rows)
            case .error: return nil
            }
        }
    }

    /// The state after the frame at `index`, replayed from the room's read as the page applies it.
    static func replayed(through index: Int) throws -> LobbyState {
        let room = try LobbyFixture.room()
        return try frames().filter { $0.index <= index }
            .reduce(LobbyState(room: room)) { $0.applying($1.rows, you: room.you) }
    }

    static func web(_ name: String) throws -> JSON {
        try #require((parity["states"] as? JSON)?[name] as? JSON)
    }

    /// A state drawn as the web draws it: the room's model under a chip, the replayed state, the web's room.
    struct Drawn {
        let model: LobbyRoomModel
        let lobby: LobbyState
        let room: JSON
    }

    static func drawn(_ name: String, filter: String = "All") throws -> Drawn {
        let web = try web(name)
        let lobby = try replayed(through: #require(web["frame"] as? Int))
        let room = try LobbyFixture.room()
        let model = try LobbyRoomModel(
            room: room, board: RoomBoardView(room.board, teams: room.teams), lobby: lobby,
            card: (web["card"] as? Int).flatMap(LobbyFixture.card),
            now: #require((web["now"] as? String).flatMap(RoomClockReading.parse)), filter: filter
        )
        return try Drawn(model: model, lobby: lobby, room: #require(web["room"] as? JSON))
    }

    @Test(arguments: states)
    func theReplayedStateIsTheWebs(name: String) throws {
        let drawn = try Self.drawn(name)
        let (lobby, web) = (drawn.lobby, drawn.room)
        let state = try #require(web["state"] as? JSON)
        #expect(Int(lobby.seq) == state["seq"] as? Int)
        #expect(lobby.pickNumber == state["pickNumber"] as? Int)
        #expect(lobby.drafting == state["drafting"] as? Bool)
        #expect(lobby.complete == state["complete"] as? Bool)
        #expect(lobby.soloPace == state["soloPace"] as? Bool)
        #expect(lobby.queue == state["queue"] as? [String])
        #expect(lobby.deadline.map(Self.iso) == state["deadline"] as? String)
        let picks = try #require(state["picks"] as? [[Any]])
        #expect(lobby.picks.map { "\($0.pick) \($0.seat) \($0.playerID) \($0.madeBy.rawValue)" }
            == picks.map { $0.map { "\($0)" }.joined(separator: " ") })
        let seats = try #require(state["seats"] as? [[Any]])
        #expect((1 ... 12).map { "\(lobby.seats[$0]?.handle ?? "-") \(lobby.seats[$0]?.kind.rawValue ?? "-")" }
            == seats.map { "\($0[1] as? String ?? "-") \($0[2] as? String ?? "-")" })
    }

    @Test(arguments: states)
    func theScoreBugTheSeatsAndTheWaitAreTheWebs(name: String) throws {
        let drawn = try Self.drawn(name)
        let (model, web) = (drawn.model, drawn.room)
        if let bug = web["bug"] as? JSON {
            let mine = try #require(model.bug)
            #expect(mine.round == bug["round"] as? String)
            #expect(mine.pick == bug["pick"] as? String)
            #expect(mine.onClock == bug["onClock"] as? String)
            #expect(mine.clock == bug["clock"] as? String)
            #expect(mine.yourPick == bug["yourPick"] as? String)
            #expect(mine.spoken == bug["spoken"] as? String)
        } else {
            #expect(model.bug == nil)
        }
        let seats = try #require(web["seats"] as? [JSON])
        #expect(model.seats.map(\.name) == seats.map { $0["name"] as? String ?? "" })
        #expect(model.seats.map(\.line) == seats.map { $0["line"] as? String ?? "" })
        #expect(model.seats.map(\.compact) == seats.map { $0["compact"] as? Bool ?? false })
        #expect(model.seats.map(\.label) == seats.map { $0["label"] as? String ?? "" })
        if let wait = web["wait"] as? JSON {
            #expect(model.wait?.count == wait["count"] as? String)
            #expect(model.wait?.words == wait["words"] as? String)
        } else {
            #expect(model.wait == nil)
        }
        let about = try #require(web["about"] as? JSON)
        #expect(model.aboutHead == about["head"] as? String)
        #expect(model.about == about["app"] as? String)
        #expect(
            LobbyWords.about(
                people: LobbySeats.people(Array(drawn.lobby.seats.values.map(\.kind))), teams: 12,
                started: drawn.lobby.drafting || drawn.lobby.complete, clockSeconds: 30,
                standIn: Words.Lobby.standInWeb
            ) == about["words"] as? String
        )
    }

    @Test(arguments: states)
    func theStripAndTheCallAreTheWebs(name: String) throws {
        let drawn = try Self.drawn(name)
        let (model, web) = (drawn.model, drawn.room)
        if let landing = web["landing"] as? JSON {
            let strip = try #require(model.landing)
            #expect(strip.lead == landing["lead"] as? String)
            #expect(strip.lines == landing["lines"] as? [String])
            let faces = try #require(landing["faces"] as? [JSON])
            #expect(strip.picks.map(\.id) == faces.map { $0["pick"] as? Int ?? 0 })
            #expect(strip.picks.map(\.name) == faces.map { $0["name"] as? String ?? "" })
            #expect(strip.picks.map(\.lines) == faces.map { $0["lines"] as? [String] ?? [] })
            #expect(strip.picks.map(\.strong) == faces.map { $0["strong"] as? Bool ?? false })
        } else {
            #expect(model.landing == nil)
        }
        if let call = web["call"] as? JSON {
            let mine = try #require(model.call)
            #expect(mine.model.tag == call["tag"] as? String)
            #expect(mine.model.chanceHead == call["chanceHead"] as? String)
            #expect(mine.model.verb == call["verb"] as? String)
            let rows = try #require(call["rows"] as? [JSON])
            #expect(mine.model.rows.map(\.player.id) == rows.map { $0["id"] as? String ?? "" })
            #expect(mine.model.rows.map(\.chance) == rows.map { $0["chance"] as? String ?? "" })
        } else {
            #expect(model.call == nil)
        }
    }

    @Test(arguments: states)
    func thePoolUnderEveryChipIsTheWebs(name: String) throws {
        let web = try Self.drawn(name).room
        let pool = try #require(web["pool"] as? JSON)
        let filters = try #require(pool["filters"] as? [JSON])
        for chip in filters {
            let filter = try #require(chip["filter"] as? String)
            let model = try Self.drawn(name, filter: filter).model
            let mine = try #require(model.pool)
            #expect(mine.model.line == pool["line"] as? String)
            #expect(mine.model.basis == pool["basis"] as? String)
            #expect(mine.model.chanceLabel == pool["chanceLabel"] as? String)
            #expect(mine.model.missing == pool["missing"] as? String)
            #expect(mine.draftShown == pool["draftShown"] as? Bool)
            #expect(mine.rows.count == chip["count"] as? Int, "\(name) \(filter)")
            #expect(mine.empty == chip["empty"] as? String)
            let rows = try #require(chip["rows"] as? [JSON])
            let first = Array(mine.rows.prefix(rows.count))
            #expect(first.map(\.id) == rows.map { $0["id"] as? String ?? "" }, "\(name) \(filter)")
            #expect(first.map(\.line.value) == rows.map { $0["value"] as? String ?? "" })
            #expect(first.map(\.line.chance) == rows.map { $0["chance"] as? String })
            #expect(first.map(\.line.isCall) == rows.map { $0["call"] as? Bool ?? false })
            #expect(first.map(\.queued) == rows.map { $0["queued"] as? Bool ?? false })
        }
    }

    @Test(arguments: states)
    func theWallAndTheTeamAreTheWebs(name: String) throws {
        let drawn = try Self.drawn(name)
        let (model, web) = (drawn.model, drawn.room)
        try Self.checkWallAndTeam(model, web)
    }

    static func checkWallAndTeam(_ model: LobbyRoomModel, _ web: JSON) throws {
        let wall = try #require(web["wall"] as? JSON)
        #expect(model.wall.names == wall["names"] as? [String])
        let rows = try #require(wall["rows"] as? [[Any]])
        #expect(model.wall.rows.map { $0.map { $0.player?.id ?? "-" } } == rows.map { $0.map { $0 as? String ?? "-" } })
        let team = try #require(web["team"] as? JSON)
        #expect(model.team.count == team["count"] as? String)
        let slots = try #require(team["slots"] as? [JSON])
        #expect(model.team.slots.map(\.slot) == slots.map { $0["slot"] as? String ?? "" })
        #expect(model.team.slots.map { $0.player?.id } == slots.map { $0["id"] as? String })
        #expect(model.team.slots.map(\.pick) == slots.map { $0["pick"] as? String })
    }

    @Test func theRoomAtItsEndIsTheWebs() throws {
        let end = try #require(Self.parity["end"] as? JSON)
        let frames = try LobbyFixture.steps()
        #expect(frames.count == end["frames"] as? Int)
        let lobby = try Self.replayed(through: frames.count)
        let web = try #require(end["room"] as? JSON)
        let state = try #require(web["state"] as? JSON)
        #expect(lobby.complete)
        #expect(Int(lobby.seq) == state["seq"] as? Int)
        #expect(lobby.picks.count == (state["picks"] as? [[Any]])?.count)
        let room = try LobbyFixture.room()
        let model = LobbyRoomModel(
            room: room, board: RoomBoardView(room.board, teams: room.teams), lobby: lobby, card: nil,
            now: Date(timeIntervalSince1970: 0)
        )
        #expect(model.pool == nil)
        #expect(model.bug == nil)
        try Self.checkWallAndTeam(model, web)
    }

    @Test func theLandingsCardsAreTheWebs() async throws {
        let landing = try #require(Self.parity["landing"] as? JSON)
        let viewModel = LobbyLandingViewModel(api: StubLobby())
        await viewModel.load()
        #expect(viewModel.head == landing["head"] as? String)
        let cards = try #require(landing["cards"] as? [JSON])
        #expect(viewModel.cards.map(\.title) == cards.map { $0["title"] as? String ?? "" })
        #expect(viewModel.cards.map(\.clock) == cards.map { $0["clock"] as? String ?? "" })
        #expect(viewModel.cards.map(\.fill) == cards.map { $0["fill"] as? String ?? "" })
        #expect(viewModel.cards.map(\.empty) == cards.map { $0["empty"] as? Bool ?? false })
        #expect(viewModel.cards.map(\.verb) == cards.map { $0["verb"] as? String ?? "" })
        #expect([0, 1, 2, 11].map { LobbyWords.fill($0).words } == landing["fills"] as? [String])
        #expect(LobbyWords.listHead([0]) == landing["emptyHead"] as? String)
    }

    @Test func theLeaveQuestionsAreTheWebs() throws {
        let leave = try #require(Self.parity["leave"] as? JSON)
        #expect(Words.Lobby.leaveFilling == leave["filling"] as? String)
        #expect(Words.Lobby.leaveDrafting == leave["drafting"] as? String)
    }

    @Test(arguments: [("first", "jpk88"), ("down", "mara")])
    func theReportIsTheWebs(key: String, handle: String) throws {
        let web = try #require((Self.parity["reports"] as? JSON)?[key] as? JSON)
        let report = try LobbyFixture.report(handle)
        let room = try LobbyFixture.room(complete: true)
        // The report is the seat's own: its names say You at its seat.
        let names = (1 ... room.teams).map { seat in
            room.seats.first { $0.seat == seat }.map { LobbySeats.name($0, you: report.slot) } ?? "Bot \(seat)"
        }
        #expect(names == web["names"] as? [String])
        let model = DraftReportModel(
            report, names: names,
            seats: LobbyWords.seats(people: LobbySeats.people(room.seats.map(LobbySeats.kind)), teams: report.teams),
            reshuffled: Words.Mock.reshuffled
        )
        try MockParityTests.checkReport(model, web)
        #expect([Words.Lobby.joinAnother, LobbyWords.soloAgain(report.slot)] == web["verbs"] as? [String])
    }

    @Test func theReportViewModelDrawsTheRoomsNames() async {
        let api = StubLobby()
        await api.setComplete(true)
        let viewModel = LobbyReportViewModel(id: LobbyFixture.id, api: api, mocks: StubMock())
        await viewModel.load()
        guard case let .report(model) = viewModel.state else {
            Issue.record("no report: \(viewModel.state)")
            return
        }
        // The recorded drafter's own report: You at seat 9, the others by handle or bot.
        #expect(model.field.first { $0.you }?.name == "You")
        #expect(model.field.contains { $0.name == "jpk88" })
        #expect(viewModel.soloVerb == LobbyWords.soloAgain(9))
    }

    static func iso(_ date: Date) -> String {
        let format = ISO8601DateFormatter()
        format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return format.string(from: date)
    }
}
